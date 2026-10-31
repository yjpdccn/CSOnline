import { FUNDS, INDICES, INVEST_SITE, MACRO, type IndexId, type MacroId } from "@/config/invest";
import { ENABLED_INVEST_SOURCES, type InvestSource } from "@/config/invest-news";
import { normalizeError } from "@/lib/pipeline/http";
import { getLlmConfig, LlmClient } from "@/lib/pipeline/llm";
import { acquireLock } from "@/lib/pipeline/store";
import { diffAlerts } from "./alerts";
import { buildFundViews, largestMove, MAX_DAILY_MOVE, mergeCloses } from "./funds";
import { mergeNews, rankNews, toInvestItem } from "./news";
import { buildAutoOverview, generateAiOverview, stopReason, translateHeadlines, type OverviewQuotes } from "./overview";
import { indexQuote, macroQuote } from "./quotes";
import { fetchFomcCalendar, fetchWscnCalendar } from "./sources/calendar";
import { fetchFeePage, fetchMobileNav, fetchNavHistory, fetchProfilePage, type FeePage, type ProfilePage } from "./sources/funds";
import {
  fetchCsindex,
  fetchDanjuan,
  fetchEastmoneyLatest,
  fetchKlines,
  fetchSinaLatest,
  fetchTencentKlines,
  fetchTreasuryRealYields,
} from "./sources/market";
import { INVEST_FETCHERS, type RawFinanceItem } from "./sources/news";
import { loadInvestStore, saveInvestStore, type InvestStore } from "./store";
import type {
  CalendarEvent,
  Close,
  FundData,
  InvestAiResult,
  InvestNewsItem,
  InvestRunSummary,
  InvestSourceResult,
  NavPoint,
  QuoteView,
  SeriesData,
  Valuation,
} from "./types";

const CONCURRENCY = 6;
/** The 基金概况 page (tracked index, benchmark) rarely changes. */
const PROFILE_MAX_AGE_MS = 7 * 86_400_000;
/** English stories given a Chinese title per run, in one request. */
const MAX_TITLES = 12;

async function mapLimit<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        results[i] = await tasks[i]();
      }
    }),
  );
  return results;
}

type Settled<T> = { ok: true; value: T; ms: number } | { ok: false; error: string; ms: number };

async function settle<T>(fn: () => Promise<T>): Promise<Settled<T>> {
  const started = Date.now();
  try {
    return { ok: true, value: await fn(), ms: Date.now() - started };
  } catch (err) {
    return { ok: false, error: normalizeError(err).message, ms: Date.now() - started };
  }
}

export interface InvestFetch {
  store: InvestStore;
  startedAt: Date;
  results: InvestSourceResult[];
  series: Partial<Record<IndexId | MacroId, SeriesData>>;
  valuations: Partial<Record<IndexId, Valuation>>;
  navs: Record<string, NavPoint[]>;
  feePages: Record<string, FeePage>;
  profiles: Record<string, ProfilePage>;
  prices: Record<string, Close[]>;
  news: { source: InvestSource; raws: RawFinanceItem[] }[];
  calendar?: CalendarEvent[];
  fomc?: string[];
}

const etfSecid = (code: string) => (/^[56]/.test(code) ? `1.${code}` : `0.${code}`);
const etfTencent = (code: string) => (/^[56]/.test(code) ? `sh${code}` : `sz${code}`);

/** Rejects a response whose latest closes jump implausibly (another instrument under the same symbol). */
async function plausibleKlines(fetcher: () => Promise<{ closes: Close[]; name: string }>) {
  const result = await fetcher();
  const move = largestMove(result.closes);
  if (move > MAX_DAILY_MOVE) throw new Error(`数据异常（单日变动 ${Math.round(move * 100)}%）`);
  return result;
}

/** 东方财富 first; 腾讯行情 for the series it also carries when 东方财富 fails or returns implausible data. */
async function fetchDaily(secid: string, tencent: string | undefined, limit: number): Promise<Settled<{ closes: Close[]; name: string; source: string }>> {
  const primary = await settle(() => plausibleKlines(() => fetchKlines(secid, limit)));
  if (primary.ok) return { ...primary, value: { ...primary.value, source: "东方财富" } };
  if (!tencent) return primary;
  const fallback = await settle(() => plausibleKlines(() => fetchTencentKlines(tencent, limit)));
  if (!fallback.ok) return { ...primary, error: `${primary.error}；腾讯行情：${fallback.error}` };
  return { ok: true, ms: primary.ms + fallback.ms, value: { ...fallback.value, source: "腾讯行情" } };
}

/** One status row for a group of similar requests (one per fund or series). */
function groupResult(id: string, name: string, kind: string, settled: Settled<unknown>[], labels: string[]): InvestSourceResult {
  const failed = settled.map((s, i) => (s.ok ? null : `${labels[i]}：${s.error}`)).filter(Boolean) as string[];
  const result: InvestSourceResult = {
    id,
    name,
    kind,
    ok: failed.length < settled.length,
    count: settled.length - failed.length,
    total: settled.length,
    ms: Math.max(0, ...settled.map((s) => s.ms)),
  };
  if (failed.length) result.error = failed.slice(0, 3).join("；") + (failed.length > 3 ? ` 等 ${failed.length} 项` : "");
  return result;
}

/** Fetches every input of the page. Never throws: failures are recorded per source and old data is kept. */
export async function fetchInvest(now = new Date()): Promise<InvestFetch> {
  const startedAt = new Date();
  const store = await loadInvestStore();
  const out: InvestFetch = { store, startedAt, results: [], series: {}, valuations: {}, navs: {}, feePages: {}, profiles: {}, prices: {}, news: [] };

  const eastmoney: { id: IndexId | MacroId; secid: string; tencent?: string; csindex?: string; sina?: string; label: string }[] = [
    ...INDICES.map((i) => ({ id: i.id, secid: i.secid, tencent: i.tencent, csindex: i.csindex, sina: i.sina, label: i.name })),
    ...MACRO.flatMap((m) => (m.source.kind === "eastmoney" ? [{ id: m.id, secid: m.source.secid, sina: m.sina, label: m.name }] : [])),
  ];
  const fallbacks: string[] = [];
  const etfs = FUNDS.filter((f) => f.etf || f.lof);
  const profileDue = FUNDS.filter((f) => {
    const asOf = store.funds.funds[f.code]?.tracking?.asOf;
    return !asOf || now.getTime() - Date.parse(asOf) > PROFILE_MAX_AGE_MS;
  });
  const csindex = INDICES.filter((i) => i.valuation?.source === "csindex");

  const tasks: (() => Promise<void>)[] = [];
  const quoteSettled: Settled<unknown>[] = new Array(eastmoney.length + etfs.length);
  eastmoney.forEach((s, i) =>
    tasks.push(async () => {
      const r = await fetchDaily(s.secid, s.tencent, 120);
      quoteSettled[i] = r;
      if (!r.ok) return;
      out.series[s.id] = { name: r.value.name, closes: r.value.closes, source: r.value.source, fetchedAt: new Date().toISOString() };
      if (r.value.source !== "东方财富") fallbacks.push(`${s.label}（${r.value.source}）`);
    }),
  );
  etfs.forEach((f, i) =>
    tasks.push(async () => {
      const r = await fetchDaily(etfSecid(f.code), etfTencent(f.code), 60);
      quoteSettled[eastmoney.length + i] = r;
      if (!r.ok) return;
      out.prices[f.code] = r.value.closes;
      if (r.value.source !== "东方财富") fallbacks.push(`${f.code}（${r.value.source}）`);
    }),
  );
  let treasury: Settled<Close[]> | undefined;
  tasks.push(async () => {
    treasury = await settle(() => fetchTreasuryRealYields(now));
    if (treasury.ok) out.series.real10y = { name: "10-year TIPS real yield", closes: treasury.value.slice(-120), source: "美国财政部", fetchedAt: new Date().toISOString() };
  });
  let danjuan: Settled<Map<string, Valuation>> | undefined;
  tasks.push(async () => {
    danjuan = await settle(() => fetchDanjuan());
    if (!danjuan.ok) return;
    for (const index of INDICES) {
      const v = index.valuation?.source === "danjuan" ? danjuan.value.get(index.valuation.code) : undefined;
      if (v) out.valuations[index.id] = v;
    }
  });
  const csindexSettled: Settled<unknown>[] = new Array(csindex.length);
  const csindexCloses = new Map<IndexId, Close[]>();
  csindex.forEach((index, i) =>
    tasks.push(async () => {
      const r = await settle(() => fetchCsindex(index.valuation!.code, now));
      csindexSettled[i] = r;
      if (!r.ok) return;
      out.valuations[index.id] = r.value.valuation;
      if (r.value.closes.length) csindexCloses.set(index.id, r.value.closes.slice(-120));
    }),
  );
  const navSettled: Settled<unknown>[] = new Array(FUNDS.length);
  const navFallbacks: string[] = [];
  const feeSettled: Settled<unknown>[] = new Array(FUNDS.length);
  FUNDS.forEach((f, i) => {
    tasks.push(async () => {
      const r = await settle(() => fetchNavHistory(f.code));
      navSettled[i] = r;
      if (r.ok) {
        out.navs[f.code] = r.value;
        return;
      }
      // The latest NAV from the app API keeps the card current; the stored history fills in the rest.
      const latest = await settle(() => fetchMobileNav(f.code));
      if (!latest.ok) return;
      const stored = (store.funds.funds[f.code]?.navs ?? []).filter((n) => n.date !== latest.value.date);
      out.navs[f.code] = [latest.value, ...stored].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
      navSettled[i] = { ok: true, value: out.navs[f.code], ms: r.ms + latest.ms };
      navFallbacks.push(f.code);
    });
    tasks.push(async () => {
      const r = await settle(() => fetchFeePage(f.code));
      feeSettled[i] = r;
      if (r.ok) out.feePages[f.code] = r.value;
    });
  });
  const profileSettled: Settled<unknown>[] = new Array(profileDue.length);
  profileDue.forEach((f, i) =>
    tasks.push(async () => {
      const r = await settle(() => fetchProfilePage(f.code));
      profileSettled[i] = r;
      if (r.ok) out.profiles[f.code] = r.value;
    }),
  );
  const newsSettled: Settled<RawFinanceItem[]>[] = new Array(ENABLED_INVEST_SOURCES.length);
  ENABLED_INVEST_SOURCES.forEach((source, i) =>
    tasks.push(async () => {
      newsSettled[i] = await settle(() => INVEST_FETCHERS[source.type](source));
    }),
  );
  let calendar: Settled<CalendarEvent[]> | undefined;
  let fomc: Settled<string[]> | undefined;
  tasks.push(async () => {
    calendar = await settle(() => fetchWscnCalendar(now, INVEST_SITE.calendarDays + 1));
    if (calendar.ok) out.calendar = calendar.value;
  });
  tasks.push(async () => {
    fomc = await settle(() => fetchFomcCalendar(now));
    if (fomc.ok) out.fomc = fomc.value;
  });

  await mapLimit(tasks, CONCURRENCY);

  // Backups for what the K-line sources could not give: 中证指数's own closes for its indices, then the
  // latest value from 东方财富's delayed host or 新浪, which extends the stored history.
  const fetchedAt = new Date().toISOString();
  for (const [i, s] of eastmoney.entries()) {
    if (out.series[s.id] || !s.csindex) continue;
    let closes = csindexCloses.get(s.id as IndexId);
    if (!closes) {
      const r = await settle(() => fetchCsindex(s.csindex!, now, 200));
      if (r.ok) closes = r.value.closes;
    }
    if (!closes?.length) continue;
    out.series[s.id] = { name: s.label, closes: closes.slice(-120), source: "中证指数", fetchedAt };
    quoteSettled[i] = { ok: true, value: closes, ms: quoteSettled[i]?.ms ?? 0 };
    fallbacks.push(`${s.label}（中证指数）`);
  }
  const latestTargets = [
    ...eastmoney.flatMap((s, i) => (out.series[s.id] ? [] : [{ key: s.id as string, secid: s.secid, sina: s.sina, label: s.label, slot: i, etf: false }])),
    ...etfs.flatMap((f, k) => (out.prices[f.code] ? [] : [{ key: f.code, secid: etfSecid(f.code), sina: undefined, label: f.code, slot: eastmoney.length + k, etf: true }])),
  ];
  if (latestTargets.length) {
    const em = await settle(() => fetchEastmoneyLatest(latestTargets.map((t) => t.secid)));
    const sinaSymbols = latestTargets.filter((t) => t.sina && !(em.ok && em.value.has(t.secid))).map((t) => t.sina!);
    const sina = sinaSymbols.length ? await settle(() => fetchSinaLatest(sinaSymbols)) : undefined;
    for (const t of latestTargets) {
      const fromEastmoney = em.ok ? em.value.get(t.secid) : undefined;
      const fromSina = !fromEastmoney && t.sina && sina?.ok ? sina.value.get(t.sina) : undefined;
      const quote = fromEastmoney ?? fromSina;
      if (!quote) continue;
      const source = fromEastmoney ? "东方财富延时行情" : "新浪行情";
      const closes: Close[] = [[quote.date, quote.value]];
      if (t.etf) out.prices[t.key] = closes;
      else out.series[t.key as IndexId | MacroId] = { name: t.label, closes, source, fetchedAt };
      quoteSettled[t.slot] = { ok: true, value: closes, ms: quoteSettled[t.slot]?.ms ?? 0 };
      fallbacks.push(`${t.label}（${source}，最新值）`);
    }
  }

  // Fresh closes extend the stored history; one that does not join it plausibly is dropped for this run.
  const rejected: string[] = [];
  for (const s of eastmoney) {
    const fresh = out.series[s.id];
    if (!fresh) continue;
    const merged = mergeCloses(store.market.series[s.id]?.closes, fresh.closes);
    if (merged) fresh.closes = merged;
    else {
      delete out.series[s.id];
      rejected.push(s.label);
    }
  }
  for (const f of etfs) {
    const fresh = out.prices[f.code];
    if (!fresh) continue;
    const merged = mergeCloses(store.funds.funds[f.code]?.prices, fresh, 60);
    if (merged) out.prices[f.code] = merged;
    else {
      delete out.prices[f.code];
      rejected.push(f.code);
    }
  }

  const single = (id: string, name: string, kind: string, s: Settled<unknown> | undefined, count: number): InvestSourceResult =>
    s?.ok ? { id, name, kind, ok: true, count, ms: s.ms } : { id, name, kind, ok: false, count: 0, ms: s?.ms ?? 0, error: s && !s.ok ? s.error : "未运行" };

  out.results.push(groupResult("eastmoney-quotes", "东方财富行情", "行情", quoteSettled, [...eastmoney.map((s) => s.label), ...etfs.map((f) => f.code)]));
  if (fallbacks.length) {
    out.results.push({ id: "fallback-quotes", name: "备用行情来源", kind: "行情", ok: true, count: fallbacks.length, ms: 0, error: `东方财富未响应，改用：${fallbacks.join("、")}` });
  }
  if (rejected.length) {
    out.results.push({ id: "rejected-quotes", name: "行情校验", kind: "行情", ok: true, count: rejected.length, ms: 0, error: `与已有数据衔接异常，沿用上次数据：${rejected.join("、")}` });
  }
  out.results.push(
    single("treasury", "美国财政部实际利率", "行情", treasury, treasury?.ok ? treasury.value.length : 0),
    single("danjuan", "蛋卷基金估值", "估值", danjuan, danjuan?.ok ? danjuan.value.size : 0),
  );
  if (csindex.length) out.results.push(groupResult("csindex", "中证指数市盈率与行情", "估值", csindexSettled, csindex.map((i) => i.name)));
  out.results.push(groupResult("fund-nav", "天天基金净值", "基金", navSettled, FUNDS.map((f) => f.code)));
  if (navFallbacks.length) {
    out.results.push({ id: "fund-nav-app", name: "天天基金净值（备用）", kind: "基金", ok: true, count: navFallbacks.length, ms: 0, error: `净值接口超时，改用 App 接口的最新净值：${navFallbacks.join("、")}` });
  }
  out.results.push(groupResult("fund-fees", "天天基金费率与申购状态", "基金", feeSettled, FUNDS.map((f) => f.code)));
  if (profileDue.length) out.results.push(groupResult("fund-profile", "天天基金基金概况", "基金", profileSettled, profileDue.map((f) => f.code)));
  ENABLED_INVEST_SOURCES.forEach((source, i) => {
    const s = newsSettled[i];
    if (s.ok) out.news.push({ source, raws: s.value });
    out.results.push(single(source.id, source.name, "新闻", s, s.ok ? s.value.length : 0));
  });
  out.results.push(
    single("wscn-calendar", "华尔街见闻财经日历", "日历", calendar, calendar?.ok ? calendar.value.length : 0),
    single("fomc", "美联储议息日程", "日历", fomc, fomc?.ok ? fomc.value.length : 0),
  );
  return out;
}

function mergeFunds(fetched: InvestFetch, now: Date): Record<string, FundData> {
  const at = now.toISOString();
  const funds: Record<string, FundData> = {};
  for (const fund of FUNDS) {
    const stored = fetched.store.funds.funds[fund.code];
    const data: FundData = { ...stored, code: fund.code, updatedAt: at };
    delete data.errors;
    const navs = fetched.navs[fund.code];
    if (navs) data.navs = navs;
    const fee = fetched.feePages[fund.code];
    if (fee?.status) data.status = { ...fee.status, asOf: at };
    if (fee && Object.keys(fee.fees).length) data.fees = { ...fee.fees, asOf: at };
    const profile = fetched.profiles[fund.code];
    if (profile) {
      if (profile.name) data.name = profile.name;
      if (profile.type) data.type = profile.type;
      data.tracking = { index: profile.index, benchmark: profile.benchmark, asOf: at };
    }
    const prices = fetched.prices[fund.code];
    if (prices) data.prices = prices;
    funds[fund.code] = data;
  }
  return funds;
}

function overviewQuotes(store: InvestStore): OverviewQuotes {
  const pick = (ids: IndexId[]) => ids.map((id) => indexQuote(store.market, id)).filter(Boolean) as QuoteView[];
  const macro = (ids: MacroId[]) => ids.map((id) => macroQuote(store.market, id)).filter(Boolean) as QuoteView[];
  const used = new Set(FUNDS.map((f) => f.index));
  return {
    us: pick((["ndx", "spx", "spxew"] as IndexId[]).filter((id) => used.has(id) && id !== "spxew")),
    cn: pick((["a500", "csi300", "divlowvol"] as IndexId[]).filter((id) => used.has(id))),
    gold: macro(["xau", "shau"]),
    rates: macro(["dxy", "real10y"]),
  };
}

export interface InvestProcessOptions {
  client: LlmClient | null;
  /** End of the run's AI time budget (shared with AI 日报). */
  deadline: number;
  now?: Date;
  trigger?: string;
  log?: (message: string) => void;
}

/** Merges a fetch into the stored data, recomputes alerts, writes the overview and saves everything. */
export async function processInvest(fetched: InvestFetch, opts: InvestProcessOptions): Promise<InvestRunSummary> {
  const now = opts.now ?? new Date();
  const store = fetched.store;
  const at = now.toISOString();

  store.market = {
    updatedAt: at,
    series: { ...store.market.series, ...fetched.series },
    valuations: { ...store.market.valuations, ...fetched.valuations },
  };
  store.funds = { updatedAt: at, funds: mergeFunds(fetched, now) };

  const fresh: InvestNewsItem[] = [];
  let fetchedCount = 0;
  for (const { source, raws } of fetched.news) {
    fetchedCount += raws.length;
    for (const raw of raws) {
      const item = toInvestItem(raw, source, now);
      if (item) fresh.push(item);
    }
  }
  const merged = mergeNews(store.news.items, fresh, now);
  store.news = { updatedAt: at, items: merged.items };
  const ranked = rankNews(merged.items, now);

  const horizon = now.getTime() - 6 * 3600_000;
  store.calendar = {
    updatedAt: fetched.calendar ? at : store.calendar.updatedAt,
    events: (fetched.calendar ?? store.calendar.events).filter((e) => Date.parse(e.at) >= horizon),
    fomc: (fetched.fomc ?? store.calendar.fomc).filter((t) => Date.parse(t) >= horizon),
  };

  store.alerts = diffAlerts(store.alerts, buildFundViews(store.funds.funds, store.market), now);

  const ai: InvestAiResult = { enabled: Boolean(opts.client), titles: 0, overview: "fallback", requests: 0 };
  const quotes = overviewQuotes(store);
  let overview = buildAutoOverview(quotes, ranked, now);
  if (opts.client) {
    const client = opts.client;
    const before = client.requests;
    const recent = ranked.filter(({ item }) => now.getTime() - Date.parse(item.publishedAt) <= 48 * 3600_000);
    const untranslated = recent
      .slice(0, 40)
      .map(({ item }) => item)
      .filter((i) => i.lang === "en" && !i.ai?.title)
      .slice(0, MAX_TITLES);
    try {
      ai.titles = await translateHeadlines(client, untranslated, opts.deadline);
    } catch (err) {
      ai.error = `英文标题：${stopReason(err)}`;
      opts.log?.(ai.error);
    }
    try {
      overview = await generateAiOverview(client, quotes, recent.length ? recent : ranked, opts.deadline, now);
      ai.overview = "ai";
    } catch (err) {
      ai.error = [ai.error, `市场概览：${stopReason(err)}`].filter(Boolean).join("；");
      opts.log?.(`市场概览：${stopReason(err)}`);
      overview = buildAutoOverview(quotes, ranked, now);
    }
    ai.requests = client.requests - before;
  }
  store.overview = overview;

  const finishedAt = new Date();
  const summary: InvestRunSummary = {
    startedAt: fetched.startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - fetched.startedAt.getTime(),
    trigger: opts.trigger ?? "manual",
    sources: fetched.results,
    news: { fetched: fetchedCount, relevant: fresh.length, added: merged.added },
    ai,
  };
  store.meta.lastRun = summary;
  const entry: Partial<InvestRunSummary> = { ...summary };
  delete entry.sources;
  store.meta.history = [entry as Omit<InvestRunSummary, "sources">, ...store.meta.history];
  await saveInvestStore(store);
  return summary;
}

export interface InvestOnlyOptions {
  trigger?: string;
  noLlm?: boolean;
  log?: (message: string) => void;
}

/** `npm run refresh -- --invest-only`: the 投资日报 part alone, with the whole AI budget. */
export async function runInvestRefresh(opts: InvestOnlyOptions = {}): Promise<InvestRunSummary> {
  const release = await acquireLock();
  try {
    const { config } = getLlmConfig();
    const client = config && !opts.noLlm ? new LlmClient(config, fetch, { log: opts.log }) : null;
    const deadline = Date.now() + (config?.budgetMs ?? 0);
    const fetched = await fetchInvest();
    return await processInvest(fetched, { client, deadline, trigger: opts.trigger, log: opts.log });
  } finally {
    await release();
  }
}
