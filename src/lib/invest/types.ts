import type { FundGroup, IndexId, MacroId, Market } from "@/config/invest";
import type { InvestTopic } from "@/config/invest-news";
import type { NewsItem } from "@/lib/types";

/** One daily close: [YYYY-MM-DD, value]. */
export type Close = [string, number];

export interface SeriesData {
  /** Name the source gives the series. */
  name: string;
  /** Ascending by date. */
  closes: Close[];
  source: string;
  fetchedAt: string;
}

export interface Valuation {
  pe?: number;
  pb?: number;
  /** Share of trading days since `since` with a lower or equal value, 0–1. */
  pePercentile?: number;
  pbPercentile?: number;
  since?: string;
  /** Trading day the figures are for. */
  date: string;
  source: string;
}

export interface MarketFile {
  updatedAt: string;
  series: Partial<Record<IndexId | MacroId, SeriesData>>;
  valuations: Partial<Record<IndexId, Valuation>>;
}

export interface FundStatus {
  /** 申购状态 as 天天基金 shows it: 开放申购, 限大额, 暂停申购… */
  purchase: string;
  redeem?: string;
  /** 定投状态: 支持 / 不支持. */
  dca?: string;
  /** 日累计申购限额 in yuan; null when there is none (无限额). Absent for on-exchange ETFs. */
  limit?: number | null;
}

/** Yearly fees in percent. */
export interface FundFees {
  management?: number;
  custody?: number;
  /** 销售服务费, charged by C shares. */
  service?: number;
}

export interface NavPoint {
  date: string;
  nav: number;
  changePct?: number;
}

export interface FundData {
  code: string;
  name?: string;
  /** 天天基金 fund type, e.g. 指数型-海外股票. */
  type?: string;
  /** Latest first. */
  navs?: NavPoint[];
  status?: FundStatus & { asOf: string };
  fees?: FundFees & { asOf: string };
  tracking?: { index?: string; benchmark?: string; asOf: string };
  /** On-exchange ETFs: daily closing prices, ascending. */
  prices?: Close[];
  updatedAt: string;
  errors?: string[];
}

export interface FundsFile {
  updatedAt: string;
  funds: Record<string, FundData>;
}

export interface InvestNewsItem extends NewsItem {
  topics: InvestTopic[];
  /** The source's own importance mark: 华尔街见闻 score, 财联社 level, 东方财富 red headline. */
  flag?: number;
}

export interface NewsFile {
  updatedAt: string;
  items: InvestNewsItem[];
}

export interface CalendarEvent {
  id: string;
  at: string;
  /** The source gives no time of day. */
  dateOnly?: boolean;
  country: string;
  title: string;
  /** 1–4, 4 being the most important. */
  importance: number;
  kind: "data" | "event" | "fomc";
  previous?: string;
  forecast?: string;
  actual?: string;
  unit?: string;
  source: string;
  url?: string;
}

export interface CalendarFile {
  updatedAt: string;
  events: CalendarEvent[];
  /** Upcoming FOMC statement times (ISO), from the Fed's meeting calendar. */
  fomc: string[];
}

export type AlertSeverity = "bad" | "warn" | "good" | "info";

export type AlertKind = "limit-down" | "limit-up" | "fee-change" | "premium-low" | "premium-high" | "premium-unusual";

/** A change seen between two runs; kept for a while so it stays visible. */
export interface AlertEvent {
  id: string;
  kind: AlertKind;
  code: string;
  at: string;
  from?: string;
  to?: string;
  severity: AlertSeverity;
}

/** QDII ETFs: under 2% / 2–3% / over 3%. Domestic ETFs: normal or unusually far from NAV. */
export type PremiumBand = "low" | "mid" | "high" | "normal" | "unusual";

export interface LastSeen {
  purchase?: string;
  limit?: number | null;
  dca?: string;
  fees?: FundFees;
  premiumBand?: PremiumBand;
  at: string;
}

export interface AlertsFile {
  updatedAt: string;
  lastSeen: Record<string, LastSeen>;
  events: AlertEvent[];
}

export interface OverviewFile {
  generatedAt: string;
  mode: "ai" | "fallback";
  model?: string;
  text: string;
  points: { text: string; refs: string[] }[];
}

export interface InvestSourceResult {
  id: string;
  name: string;
  /** 行情 / 基金 / 估值 / 新闻 / 日历 */
  kind: string;
  ok: boolean;
  /** Items fetched; for grouped requests (one per fund or series), the requests that succeeded. */
  count: number;
  /** Requests in the group, when there are several. */
  total?: number;
  ms: number;
  error?: string;
}

export interface InvestAiResult {
  enabled: boolean;
  /** English headlines given a Chinese title this run. */
  titles: number;
  overview: "ai" | "fallback";
  requests: number;
  /** Technical detail for logs; never shown on the page. */
  error?: string;
}

export interface InvestRunSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  trigger: string;
  sources: InvestSourceResult[];
  news: { fetched: number; relevant: number; added: number };
  ai: InvestAiResult;
}

export interface InvestMetaFile {
  lastRun?: InvestRunSummary;
  history: Omit<InvestRunSummary, "sources">[];
}

/** Everything a fund card needs, computed on the server. */
export interface FundView {
  code: string;
  name: string;
  group: FundGroup;
  tag?: string;
  etf: boolean;
  lof: boolean;
  index: IndexId;
  indexName: string;
  type?: string;
  nav?: NavPoint;
  /** NAV or price change over about a week, percent. */
  weekPct?: number;
  price?: { close: number; date: string; changePct?: number };
  premium?: Premium;
  status?: FundStatus & { asOf: string };
  fees?: FundFees & { asOf: string; total?: number };
  feeRule?: FeeRuleCheck;
  tracking?: string;
  benchmark?: string;
  watchLimit: boolean;
  watchPremium: boolean;
}

export interface Premium {
  kind: "qdii" | "domestic";
  /** Percent over NAV; negative is a discount. */
  value: number;
  band: PremiumBand;
  price: number;
  priceDate: string;
  nav: number;
  navDate: string;
  /** NAV moved forward by the index and exchange-rate change since `navDate`. */
  estimated: boolean;
}

export interface FeeRuleCheck {
  kind: "domestic" | "qdii";
  cap: number;
  total: number;
  ok: boolean;
}

export interface QuoteView {
  id: string;
  name: string;
  last: number;
  date: string;
  change?: number;
  changePct?: number;
  weekPct?: number;
  /** Change in basis points for yields. */
  changeBp?: number;
  weekBp?: number;
  history: number[];
  unit?: string;
  decimals: number;
  yieldSeries?: boolean;
  proxy?: string;
  source: string;
}

export interface IndexView {
  id: IndexId;
  name: string;
  market: Market;
  quote?: QuoteView;
  valuation?: Valuation;
  /** Index funds tracking the index, and funds without one that use the card as a reference (bond funds). */
  funds: { code: string; name: string; role: "tracks" | "reference" }[];
  news: NewsRef[];
}

export interface NewsRef {
  id: string;
  title: string;
  url: string;
  sourceName: string;
  publishedAt: string;
}
