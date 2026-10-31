import { FUND_GROUPS, FUNDS, INDICES, INVEST_RULES, INVEST_SITE, MACRO, PLAN_GROUPS, type FundGroup, type MacroId } from "@/config/invest";
import type { InvestTopic } from "@/config/invest-news";
import { translatedTitle, truncate } from "@/lib/pipeline/text";
import { zonedParts } from "@/lib/time";
import { describeStatus, statusRank } from "./alerts";
import { buildFundViews } from "./funds";
import { marketNews, newsRef, rankNews, type RankedCard } from "./news";
import { indexQuote, macroQuote } from "./quotes";
import { loadInvestStore } from "./store";
import type {
  AlertEvent,
  AlertSeverity,
  CalendarEvent,
  FundView,
  IndexView,
  InvestRunSummary,
  NewsRef,
  OverviewFile,
  Premium,
  QuoteView,
} from "./types";

export interface AlertItem {
  id: string;
  severity: AlertSeverity;
  /** Change events carry the time they were seen. */
  at?: string;
  code?: string;
  title: string;
  detail: string;
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

export interface InvestPageData {
  /** End of the last update; null before the first one. */
  updatedAt: string | null;
  /** Reference time of the data (start of the last update). */
  asOf: string;
  alerts: AlertItem[];
  watch: WatchRow[];
  premiums: PremiumRow[];
  overview: (Omit<OverviewFile, "points"> & { points: { text: string; refs: NewsRef[] }[] }) | null;
  groups: { id: FundGroup; label: string; hint: string; funds: (FundView & { news?: NewsRef })[] }[];
  indices: IndexView[];
  gold: { spot?: QuoteView; shanghai?: QuoteView; drivers: QuoteView[]; centralBanks: NewsRef[] };
  macro: QuoteView[];
  news: InvestNewsCard[];
  calendar: { events: CalendarEvent[]; nextFomc?: string };
  run: InvestRunSummary | null;
}

const fundName = (code: string, views: FundView[]) => views.find((v) => v.code === code)?.name ?? FUNDS.find((f) => f.code === code)?.name ?? code;

const isQdii = (code: string) => INDICES.find((i) => i.id === FUNDS.find((f) => f.code === code)?.index)?.market === "us";

/** "按 10月28日净值" for a premium, with how it was estimated. */
function premiumBasis(p: Premium): string {
  const day = `${Number(p.navDate.slice(5, 7))}月${Number(p.navDate.slice(8))}日`;
  if (p.kind === "domestic") return `按 ${day}收盘价和净值`;
  return `按 ${day}净值${p.estimated ? "和此后的指数涨跌估算" : ""}`;
}

function eventItem(event: AlertEvent, views: FundView[]): AlertItem {
  const fund = FUNDS.find((f) => f.code === event.code);
  const name = `${fundName(event.code, views)}（${event.code}）`;
  const base = { id: event.id, severity: event.severity, at: event.at, code: event.code };
  switch (event.kind) {
    case "limit-down":
      return {
        ...base,
        title: `${name} 申购额度收紧`,
        detail: `${event.from} → ${event.to}。${fund?.group === "dca" ? "记得调整定投金额，避免扣款失败。" : "暂时买不了或只能少买。"}`,
      };
    case "limit-up": {
      const plan = fund && PLAN_GROUPS.includes(fund.group);
      return {
        ...base,
        title: `${name} 申购额度放开`,
        detail: `${event.from} → ${event.to}。${plan && isQdii(event.code) ? "海外部分有加大投入的空间。" : "可以正常申购了。"}`,
      };
    }
    case "fee-change":
      return { ...base, title: `${name} 费率调整`, detail: `${event.from} → ${event.to}` };
    case "premium-low":
      return { ...base, title: `${name} 溢价降到 ${INVEST_RULES.premium.low}% 以内`, detail: `溢价从 ${event.from} 降到 ${event.to}。` };
    case "premium-high":
      return { ...base, title: `${name} 溢价回升`, detail: `溢价从 ${event.from} 升到 ${event.to}，超过 ${INVEST_RULES.premium.low}% 不买。` };
    case "premium-unusual":
      return { ...base, title: `${name} 溢价偏离较大`, detail: `从${event.from}变为 ${event.to}，境内 ETF 通常只在净值上下零点几个百分点。` };
  }
}

/** Alerts at the top of the page: recent changes, then states that need attention now. */
function buildAlerts(events: AlertEvent[], views: FundView[], asOf: Date): AlertItem[] {
  const recent = events.filter((e) => asOf.getTime() - Date.parse(e.at) <= INVEST_SITE.alertDays * 86_400_000);
  const items = recent.map((e) => eventItem(e, views));
  const { low, high } = INVEST_RULES.premium;
  for (const view of views) {
    const p = view.premium;
    if (!p) continue;
    const basis = premiumBasis(p);
    const id = `premium-${view.code}`;
    const title = `${view.name}（${view.code}）${p.value < 0 ? `折价 ${Math.abs(p.value)}%` : `溢价 ${p.value}%`}`;
    if (p.kind === "domestic") {
      // Domestic ETFs are flagged only when unusually far from NAV; the premium strip shows the rest.
      if (p.band === "unusual") {
        items.push({ id, severity: "warn", code: view.code, title, detail: `偏离净值超过 ${INVEST_RULES.domesticPremium.unusual}%，买卖前留意（${basis}）。` });
      }
      continue;
    }
    items.push(
      p.band === "low"
        ? { id, severity: "good", code: view.code, title, detail: `已在 ${low}% 以内（${basis}）。` }
        : {
            id,
            severity: p.band === "high" ? "bad" : "warn",
            code: view.code,
            title,
            detail: `${p.band === "high" ? `超过 ${high}%` : `在 ${low}%–${high}% 之间`}，按规则不买（${basis}）。`,
          },
    );
  }
  // Fee-rule breaks are standing facts rather than news, so they share one item.
  const expensive = views.filter((v) => v.feeRule && !v.feeRule.ok);
  if (expensive.length) {
    const list = (kind: "qdii" | "domestic") =>
      expensive
        .filter((v) => v.feeRule!.kind === kind)
        .map((v) => `${v.code} ${v.feeRule!.total.toFixed(2)}%`)
        .join("、");
    const qdii = list("qdii");
    const domestic = list("domestic");
    const { domestic: domesticCap, qdii: qdiiCap } = INVEST_RULES.feeCap;
    items.push({
      id: "fee-rule",
      severity: "warn",
      title: `${expensive.length} 只指数基金费率高于规则`,
      detail: [
        qdii && `QDII 管理费加托管费超过 ${qdiiCap}%/年：${qdii}`,
        domestic && `A 股和黄金指数基金高于约 ${domesticCap}%/年：${domestic}`,
      ]
        .filter(Boolean)
        .join("；") + "。",
    });
  }
  if (zonedParts(asOf).day <= INVEST_RULES.monthlyCheckDays) {
    const month = zonedParts(asOf).month;
    items.push({
      id: `monthly-${month}`,
      severity: "info",
      title: `${month}月定投扣款核对`,
      detail: "到购买平台确认本月各项定投都已扣款成功（本站看不到账户，只能自己核对）。",
    });
  }
  return items;
}

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
  const asOf = new Date(run?.startedAt ?? store.news.updatedAt ?? Date.now());
  const views = buildFundViews(store.funds.funds, store.market);
  const ranked = rankNews(store.news.items, asOf);
  const recentMs = asOf.getTime() - 72 * 3600_000;
  const recent = ranked.filter((c) => Date.parse(c.item.publishedAt) >= recentMs);
  const events = store.alerts?.events ?? [];

  const indexNews = new Map<string, NewsRef[]>();
  const indices: IndexView[] = INDICES.filter((index) => FUNDS.some((f) => f.index === index.id)).map((index) => {
    const news = marketNews(recent.length ? recent : ranked, index.market, 3).map((c) => newsRef(c.item));
    indexNews.set(index.id, news);
    // Funds without a tracked index sit on a card only when it is a reference card (bond funds on the yield card).
    const funds = views
      .filter((v) => v.index === index.id && (v.tracking || index.proxy))
      .map((v) => ({ code: v.code, name: v.name, role: v.tracking ? ("tracks" as const) : ("reference" as const) }));
    const view: IndexView = { id: index.id, name: index.name, market: index.market, funds, news };
    const quote = indexQuote(store.market, index.id);
    if (quote) view.quote = quote;
    const valuation = store.market.valuations[index.id];
    if (valuation) view.valuation = valuation;
    return view;
  });

  const groups = FUND_GROUPS.map((group) => ({
    ...group,
    funds: views.filter((v) => v.group === group.id).map((v) => ({ ...v, news: indexNews.get(v.index)?.[0] })),
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

  const macro = (ids: MacroId[]) => ids.map((id) => macroQuote(store.market, id)).filter(Boolean) as QuoteView[];
  const centralBanks = (recent.length ? ranked.filter((c) => Date.parse(c.item.publishedAt) >= asOf.getTime() - 7 * 86_400_000) : ranked)
    .filter((c) => c.topics.includes("cb-gold"))
    .slice(0, 2)
    .map((c) => newsRef(c.item));

  return {
    updatedAt: run?.finishedAt ?? null,
    asOf: asOf.toISOString(),
    alerts: buildAlerts(events, views, asOf),
    watch: watchRows(views, events.filter((e) => asOf.getTime() - Date.parse(e.at) <= INVEST_SITE.alertDays * 86_400_000)),
    premiums: premiumRows(views),
    overview,
    groups,
    indices,
    gold: { spot: macroQuote(store.market, "xau"), shanghai: macroQuote(store.market, "shau"), drivers: macro(["real10y", "dxy", "us10y"]), centralBanks },
    macro: macro(MACRO.filter((m) => m.id !== "xau" && m.id !== "shau").map((m) => m.id)),
    news: (recent.length ? recent : ranked).slice(0, 60).map(toCard),
    calendar: {
      events: store.calendar.events.filter((e) => Date.parse(e.at) >= asOf.getTime() - 3 * 3600_000 && Date.parse(e.at) <= asOf.getTime() + INVEST_SITE.calendarDays * 86_400_000),
      nextFomc: store.calendar.fomc.find((t) => Date.parse(t) >= asOf.getTime()),
    },
    run,
  };
}
