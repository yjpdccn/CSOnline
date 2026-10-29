import { fetchJson, fetchText } from "@/lib/pipeline/http";
import { dayKey } from "@/lib/time";
import type { Close, Valuation } from "../types";

const KLINE_URL = "https://push2his.eastmoney.com/api/qt/stock/kline/get";

interface KlineResponse {
  data?: { name?: string; klines?: string[] } | null;
}

export function parseKlines(body: KlineResponse): { name: string; closes: Close[] } {
  const klines = body.data?.klines ?? [];
  const closes = klines
    .map((line) => {
      const [date, close] = line.split(",");
      return [date, Number(close)] as Close;
    })
    .filter(([date, close]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(close) && close > 0);
  if (!closes.length) throw new Error("没有返回行情");
  return { name: body.data?.name ?? "", closes };
}

/** Daily closes from 东方财富 (indices, gold, ETFs, yields, FX), oldest first. */
export async function fetchKlines(secid: string, limit = 120): Promise<{ name: string; closes: Close[] }> {
  const url = `${KLINE_URL}?secid=${encodeURIComponent(secid)}&fields1=f1,f2,f3&fields2=f51,f53&klt=101&fqt=0&end=20500101&lmt=${limit}`;
  return parseKlines(await fetchJson<KlineResponse>(url, { headers: { Referer: "https://quote.eastmoney.com/" }, retries: 2 }));
}

const TREASURY_URL = (year: number) =>
  `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_real_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;

/** The 10-year column of the Treasury's daily real yield curve CSV, oldest first. */
export function parseTreasuryRealYields(csv: string): Close[] {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines.shift()?.split(",").map((h) => h.replace(/"/g, "").trim()) ?? [];
  const col = header.indexOf("10 YR");
  if (col < 0) throw new Error("CSV 中没有 10 年期数据");
  const closes: Close[] = [];
  for (const line of lines) {
    const cells = line.split(",");
    const m = cells[0]?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const value = Number(cells[col]);
    if (m && cells[col] && Number.isFinite(value)) closes.push([`${m[3]}-${m[1]}-${m[2]}`, value]);
  }
  return closes.sort((a, b) => a[0].localeCompare(b[0]));
}

export async function fetchTreasuryRealYields(now = new Date()): Promise<Close[]> {
  const year = now.getUTCFullYear();
  let closes = parseTreasuryRealYields(await fetchText(TREASURY_URL(year), { headers: { Accept: "text/csv" } }));
  // Early January: the new year's file holds only a few days.
  if (closes.length < 30) {
    const previous = parseTreasuryRealYields(await fetchText(TREASURY_URL(year - 1), { headers: { Accept: "text/csv" } }));
    closes = [...previous, ...closes];
  }
  if (!closes.length) throw new Error("没有返回数据");
  return closes;
}

interface DanjuanItem {
  index_code: string;
  name: string;
  pe?: number;
  pb?: number;
  pe_percentile?: number;
  pb_percentile?: number;
  ts?: number;
  begin_at?: number;
}

/** 蛋卷基金's valuation table: PE/PB with percentiles since `begin_at` (mid-2016 for most indices). */
export function parseDanjuan(body: { data?: { items?: DanjuanItem[] } }): Map<string, Valuation> {
  const items = body.data?.items ?? [];
  if (!items.length) throw new Error("没有返回估值");
  const map = new Map<string, Valuation>();
  for (const item of items) {
    if (!item.ts) continue;
    const valuation: Valuation = { date: dayKey(item.ts), source: "蛋卷基金" };
    if (item.pe && item.pe > 0) {
      valuation.pe = item.pe;
      if (typeof item.pe_percentile === "number") valuation.pePercentile = item.pe_percentile;
    }
    if (item.pb && item.pb > 0) {
      valuation.pb = item.pb;
      if (typeof item.pb_percentile === "number") valuation.pbPercentile = item.pb_percentile;
    }
    if (item.begin_at) valuation.since = dayKey(item.begin_at);
    map.set(item.index_code, valuation);
  }
  return map;
}

export async function fetchDanjuan(): Promise<Map<string, Valuation>> {
  return parseDanjuan(await fetchJson("https://danjuanfunds.com/djapi/index_eva/dj", { headers: { Referer: "https://danjuanfunds.com/" } }));
}

interface CsindexRow {
  tradeDate: string;
  peg?: number | null;
}

/** 中证指数's daily index performance; `peg` is the index PE it publishes. */
export function parseCsindexPe(body: { data?: CsindexRow[] }): Valuation {
  const rows = (body.data ?? []).filter((r) => typeof r.peg === "number" && r.peg > 0);
  const last = rows.at(-1);
  if (!last) throw new Error("没有返回市盈率");
  const d = last.tradeDate;
  return { pe: last.peg!, date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, source: "中证指数" };
}

export async function fetchCsindexPe(code: string, now = new Date()): Promise<Valuation> {
  const fmt = (t: number) => dayKey(t).replace(/-/g, "");
  const url = `https://www.csindex.com.cn/csindex-home/perf/index-perf?indexCode=${code}&startDate=${fmt(now.getTime() - 30 * 86_400_000)}&endDate=${fmt(now.getTime())}`;
  return parseCsindexPe(await fetchJson(url, { headers: { Referer: "https://www.csindex.com.cn/" } }));
}
