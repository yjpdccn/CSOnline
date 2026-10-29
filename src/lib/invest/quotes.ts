import { INDICES, MACRO, type IndexId, type MacroId } from "@/config/invest";
import { shiftDay } from "@/lib/time";
import { closeOnOrBefore } from "./funds";
import type { MarketFile, QuoteView, SeriesData } from "./types";

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

interface QuoteConfig {
  name: string;
  unit?: string;
  decimals: number;
  yieldSeries?: boolean;
  proxy?: string;
}

/** Latest level, change from the previous close and from about a week earlier (basis points for yields). */
export function buildQuoteView(id: string, cfg: QuoteConfig, series: SeriesData | undefined, historyLength = 30): QuoteView | undefined {
  const closes = series?.closes ?? [];
  const latest = closes.at(-1);
  if (!series || !latest) return undefined;
  const [date, last] = latest;
  const view: QuoteView = {
    id,
    name: cfg.name,
    last,
    date,
    history: closes.slice(-historyLength).map((c) => c[1]),
    decimals: cfg.decimals,
    source: series.source,
  };
  if (cfg.unit) view.unit = cfg.unit;
  if (cfg.yieldSeries) view.yieldSeries = true;
  if (cfg.proxy) view.proxy = cfg.proxy;
  const prev = closes.at(-2);
  const week = closeOnOrBefore(closes, shiftDay(date, -7));
  if (cfg.yieldSeries) {
    if (prev) view.changeBp = round((last - prev[1]) * 100, 1);
    if (week) view.weekBp = round((last - week[1]) * 100, 1);
  } else {
    if (prev) {
      view.change = round(last - prev[1], cfg.decimals);
      view.changePct = round((last / prev[1] - 1) * 100);
    }
    if (week) view.weekPct = round((last / week[1] - 1) * 100);
  }
  return view;
}

export function indexQuote(market: MarketFile, id: IndexId): QuoteView | undefined {
  const cfg = INDICES.find((i) => i.id === id);
  return cfg ? buildQuoteView(id, cfg, market.series[id]) : undefined;
}

export function macroQuote(market: MarketFile, id: MacroId): QuoteView | undefined {
  const cfg = MACRO.find((m) => m.id === id);
  return cfg ? buildQuoteView(id, cfg, market.series[id]) : undefined;
}

export function formatNumber(value: number, decimals: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** "涨 0.55%" / "跌 1.03%" / "持平". */
export function describeMove(pct: number | undefined): string {
  if (pct === undefined) return "";
  if (Math.abs(pct) < 0.005) return "持平";
  return `${pct > 0 ? "涨" : "跌"} ${Math.abs(pct).toFixed(2)}%`;
}

export function describeBp(bp: number | undefined): string {
  if (bp === undefined) return "";
  if (Math.abs(bp) < 0.5) return "持平";
  return `${bp > 0 ? "升" : "降"} ${Math.abs(Math.round(bp))}bp`;
}
