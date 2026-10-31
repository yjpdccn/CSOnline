import { FUND_GROUPS, FUNDS, INDICES, INVEST_SITE, MACRO, type FundGroup, type MacroId } from "@/config/invest";
import type { InvestTopic } from "@/config/invest-news";
import { translatedTitle, truncate } from "@/lib/pipeline/text";
import { describeStatus, statusRank } from "./alerts";
import { buildFundViews } from "./funds";
import { marketNews, newsRef, rankNews, type RankedCard } from "./news";
import { buildObservations, RULES, type Observation } from "./observations";
import { buildSuggestions } from "./suggestions";
import { indexQuote, macroQuote } from "./quotes";
import type { StatusNotifications } from "./status";
import { loadInvestStore } from "./store";
import type { AlertEvent, CalendarEvent, DataIssue, FundView, IndexView, InvestRunSummary, NewsRef, OverviewFile, Premium, QuoteView } from "./types";

export interface PageAlert extends Observation {
  /** The update that first showed it. */
  firstSeen?: string;
}

export interface WatchRow {
  code: string;
  name: string;
  status: string;
  /** 0 paused, 1 limited, 2 open. */
  rank: number;
  qdii: boolean;
  group: FundGroup;
  changedAt?: string;
}

export interface PremiumRow {
  code: string;
  name: string;
  premium: Premium;
}

export interface InvestNewsCard {
  id: string;
  title: string;
  originalTitle?: string;
  summary?: string;
  aiSummary?: boolean;
  url: string;
  sourceName: string;
  publishedAt: string;
  dateOnly?: boolean;
  topics: InvestTopic[];
  important?: boolean;
  alsoOn?: { name: string; url: string; title?: string }[];
}

export interface PageHealth {
  checkedAt: string;
  /** First check; alerts first seen then are the baseline rather than news. */
  since: string;
  issues: (DataIssue & { firstSeen?: string })[];
  notifications: StatusNotifications;
}

export type PageFund = FundView & { news?: NewsRef; navStale?: boolean; priceStale?: boolean };

export interface InvestPageData {
  /** End of the last update; null before the first one. */
  updatedAt: string | null;
  /** Reference time of the data (start of the last update). */
  asOf: string;
  /** Changes seen between updates, and reminders. */
  alerts: PageAlert[];
  /** Section 五 rules 1–4 checked against every tracked fund. */
  rules: { rule: 1 | 2 | 3 | 4; label: string; scope: string; items: PageAlert[] }[];
  /** 策略建议: replace, stop and increase suggestions, and the weekly comparison behind them. */
  strategy: { items: PageAlert[]; checkedAt: string | null; compared: number };
  /** Data health from the last update; null before the first one that checked it. */
  health: PageHealth | null;
  watch: WatchRow[];
  premiums: PremiumRow[];
  overview: (Omit<OverviewFile, "points"> & { points: { text: string; refs: NewsRef[] }[] }) | null;
  groups: { id: FundGroup; label: string; hint: string; funds: PageFund[] }[];
  indices: IndexView[];
  gold: { spot?: QuoteView; shanghai?: QuoteView; drivers: QuoteView[]; centralBanks: NewsRef[] };
  macro: QuoteView[];
  news: InvestNewsCard[];
  calendar: { events: CalendarEvent[]; nextFomc?: string };
  run: InvestRunSummary | null;
}

const isQdii = (code: string) => INDICES.find((i) => i.id === FUNDS.find((f) => f.code === code)?.index)?.market === "us";

function watchRows(views: FundView[], events: AlertEvent[]): WatchRow[] {
  return views
    .filter((v) => v.watchLimit && v.status)
    .map((v) => {
      const change = events.find((e) => e.code === v.code && (e.kind === "limit-down" || e.kind === "limit-up"));
      const row: WatchRow = {
        code: v.code,
        name: v.name,
        status: describeStatus(v.status!),
        rank: statusRank(v.status!.purchase),
        qdii: isQdii(v.code),
        group: v.group,
      };
      if (change) row.changedAt = change.at;
      return row;
    });
}

function premiumRows(views: FundView[]): PremiumRow[] {
  return views.filter((v) => v.watchPremium && v.premium).map((v) => ({ code: v.code, name: v.name, premium: v.premium! }));
}

function toCard({ item, topics }: RankedCard): InvestNewsCard {
  const aiTitle = translatedTitle(item);
  const card: InvestNewsCard = {
    id: item.id,
    title: aiTitle ?? item.title,
    url: item.url,
    sourceName: item.sourceName,
    publishedAt: item.publishedAt,
    topics,
  };
  if (aiTitle) card.originalTitle = item.title;
  const summary = item.ai?.summary || item.excerpt;
  if (summary && summary !== item.title) card.summary = truncate(summary, 140);
  if (item.ai?.summary) card.aiSummary = true;
  if (item.dateOnly) card.dateOnly = true;
  if (item.flag) card.important = true;
  const also = (item.related ?? []).filter((r) => r.sourceName !== item.sourceName);
  const seen = new Set<string>();
  const alsoOn = also.filter((r) => (seen.has(r.sourceName) ? false : (seen.add(r.sourceName), true))).map((r) => ({ name: r.sourceName, url: r.url, title: r.title }));
  if (alsoOn.length) card.alsoOn = alsoOn;
  return card;
}

export async function loadInvestPageData(): Promise<InvestPageData> {
  const store = await loadInvestStore();
  const run = store.meta.lastRun ?? null;
  const status = store.status;
  const asOf = new Date(run?.startedAt ?? store.news.updatedAt ?? Date.now());
  const views = buildFundViews(store.funds.funds, store.market);
  const ranked = rankNews(store.news.items, asOf);
  const recentMs = asOf.getTime() - 72 * 3600_000;
  const recent = ranked.filter((c) => Date.parse(c.item.publishedAt) >= recentMs);
  const events = store.alerts?.events ?? [];

  const stale = new Set(Object.values(status?.groups ?? {}).flatMap((g) => g.items.filter((i) => i.stale).map((i) => i.key)));
  const mark = <T extends QuoteView>(quote: T | undefined, key: string): T | undefined => (quote && stale.has(key) ? { ...quote, stale: true } : quote);

  const indexNews = new Map<string, NewsRef[]>();
  const indices: IndexView[] = INDICES.filter((index) => FUNDS.some((f) => f.index === index.id)).map((index) => {
    const news = marketNews(recent.length ? recent : ranked, index.market, 3).map((c) => newsRef(c.item));
    indexNews.set(index.id, news);
    // Funds without a tracked index sit on a card only when it is a reference card (bond funds on the yield card).
    const funds = views
      .filter((v) => v.index === index.id && (v.tracking || index.proxy))
      .map((v) => ({ code: v.code, name: v.name, role: v.tracking ? ("tracks" as const) : ("reference" as const) }));
    const view: IndexView = { id: index.id, name: index.name, market: index.market, funds, news };
    const quote = mark(indexQuote(store.market, index.id), index.id);
    if (quote) view.quote = quote;
    const valuation = store.market.valuations[index.id];
    if (valuation) view.valuation = valuation;
    if (valuation && stale.has(`valuation:${index.id}`)) view.valuationStale = true;
    return view;
  });

  const groups = FUND_GROUPS.map((group) => ({
    ...group,
    funds: views
      .filter((v) => v.group === group.id)
      .map((v): PageFund => {
        const fund: PageFund = { ...v, news: indexNews.get(v.index)?.[0] };
        if (stale.has(`nav:${v.code}`)) fund.navStale = true;
        if (stale.has(`price:${v.code}`)) fund.priceStale = true;
        return fund;
      }),
  }));

  let overview: InvestPageData["overview"] = null;
  if (store.overview) {
    const byId = new Map(store.news.items.map((i) => [i.id, i]));
    overview = {
      ...store.overview,
      points: store.overview.points.map((p) => ({
        text: p.text,
        refs: p.refs.flatMap((id) => {
          let item = byId.get(id);
          if (item?.dupOf) item = byId.get(item.dupOf) ?? item;
          return item ? [newsRef(item)] : [];
        }),
      })),
    };
  }

  const macro = (ids: MacroId[]) => ids.map((id) => mark(macroQuote(store.market, id), id)).filter(Boolean) as QuoteView[];
  const centralBanks = (recent.length ? ranked.filter((c) => Date.parse(c.item.publishedAt) >= asOf.getTime() - 7 * 86_400_000) : ranked)
    .filter((c) => c.topics.includes("cb-gold"))
    .slice(0, 2)
    .map((c) => newsRef(c.item));

  const firstSeen = new Map((status?.alerts ?? []).map((a) => [a.key, a.firstSeen]));
  const observations: PageAlert[] = [...buildObservations(events, views, asOf), ...buildSuggestions(views, store.strategy, events, asOf)].map((o) => {
    const seen = firstSeen.get(o.key) ?? o.at;
    return seen ? { ...o, firstSeen: seen } : o;
  });

  return {
    updatedAt: run?.finishedAt ?? null,
    asOf: asOf.toISOString(),
    alerts: observations.filter((o) => o.kind === "change" || o.kind === "reminder"),
    rules: RULES.map((r) => ({ ...r, items: observations.filter((o) => o.kind === "rule" && o.rule === r.rule) })),
    strategy: { items: observations.filter((o) => o.kind === "suggestion"), checkedAt: store.strategy.checkedAt ?? null, compared: store.strategy.compared ?? 0 },
    health: status ? { checkedAt: status.generatedAt, since: status.since, issues: status.dataIssues, notifications: status.notifications } : null,
    watch: watchRows(views, events.filter((e) => asOf.getTime() - Date.parse(e.at) <= INVEST_SITE.alertDays * 86_400_000)),
    premiums: premiumRows(views),
    overview,
    groups,
    indices,
    gold: {
      spot: mark(macroQuote(store.market, "xau"), "xau"),
      shanghai: mark(macroQuote(store.market, "shau"), "shau"),
      drivers: macro(["real10y", "dxy", "us10y"]),
      centralBanks,
    },
    macro: macro(MACRO.filter((m) => m.id !== "xau" && m.id !== "shau").map((m) => m.id)),
    news: (recent.length ? recent : ranked).slice(0, 60).map(toCard),
    calendar: {
      events: store.calendar.events.filter((e) => Date.parse(e.at) >= asOf.getTime() - 3 * 3600_000 && Date.parse(e.at) <= asOf.getTime() + INVEST_SITE.calendarDays * 86_400_000),
      nextFomc: store.calendar.fomc.find((t) => Date.parse(t) >= asOf.getTime()),
    },
    run,
  };
}
