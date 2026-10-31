import { fetchJson, fetchText } from "@/lib/pipeline/http";
import { dayKey, shiftDay, zonedTimeToUtc } from "@/lib/time";
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

interface TencentKlineResponse {
  data?: Record<string, { day?: string[][]; qfqday?: string[][] } | string | undefined> | string;
}

/** 腾讯行情 daily K lines: rows of [date, open, close, high, low, volume]. */
export function parseTencentKlines(body: TencentKlineResponse, symbol: string): { name: string; closes: Close[] } {
  const entry = typeof body.data === "object" ? body.data?.[symbol] : undefined;
  const rows = typeof entry === "object" ? (entry.day ?? entry.qfqday ?? []) : [];
  const closes = rows
    .map((row) => [row[0], Number(row[2])] as Close)
    .filter(([date, close]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(close) && close > 0);
  if (!closes.length) throw new Error("没有返回行情");
  return { name: symbol, closes };
}

/** Fallback for ETFs and the main indices when 东方财富 does not answer (it throttles some IPs). */
export async function fetchTencentKlines(symbol: string, limit = 120): Promise<{ name: string; closes: Close[] }> {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${encodeURIComponent(symbol)},day,,,${limit},`;
  return parseTencentKlines(await fetchJson<TencentKlineResponse>(url, { headers: { Referer: "https://gu.qq.com/" } }), symbol);
}

/** Latest value of a series and the trading day it belongs to. */
export interface LatestQuote {
  date: string;
  value: number;
}

/** Calendar date in New York: the trading day of US and around-the-clock markets (gold, FX, the dollar index). */
function nyDay(time: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(time);
}

/** Quote hosts stamp weekend refreshes and night sessions with Saturday's date; the value is Friday's. */
export function weekdayOf(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return weekday === 6 ? shiftDay(day, -1) : weekday === 0 ? shiftDay(day, -2) : day;
}

/** China's markets, 中证 indices, 上海黄金交易所 and China's bond yields trade on Beijing days. */
const BEIJING_SECIDS = /^(?:0|1|2|118)\.|^171\.CN/;

interface UlistResponse {
  data?: { diff?: { f2?: number | string; f12?: string; f13?: number; f124?: number }[] | null } | null;
}

export function parseEastmoneyLatest(body: UlistResponse): Map<string, LatestQuote> {
  const map = new Map<string, LatestQuote>();
  for (const row of body.data?.diff ?? []) {
    const value = Number(row.f2);
    if (!row.f12 || row.f13 === undefined || !row.f124 || !Number.isFinite(value) || value <= 0) continue;
    const secid = `${row.f13}.${row.f12}`;
    const time = row.f124 * 1000;
    map.set(secid, { date: weekdayOf(BEIJING_SECIDS.test(secid) ? dayKey(time) : nyDay(time)), value });
  }
  return map;
}

/** 东方财富's delayed quote host: the latest value of many series in one request, when its K-line host refuses. */
export async function fetchEastmoneyLatest(secids: string[]): Promise<Map<string, LatestQuote>> {
  const url = `https://push2delay.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${secids.join(",")}&fields=f2,f12,f13,f18,f124`;
  const map = parseEastmoneyLatest(await fetchJson<UlistResponse>(url, { headers: { Referer: "https://quote.eastmoney.com/" } }));
  if (!map.size) throw new Error("没有返回行情");
  return map;
}

/** Where 新浪 puts the value and the date (and time, for markets dated in New York) in each quote line. */
const SINA_FIELDS: Record<string, { value: number; date: number; time?: number }> = {
  hf_XAU: { value: 0, date: 12, time: 6 },
  SGE_AU9999: { value: 3, date: 16 },
  DINIW: { value: 1, date: 10, time: 0 },
  fx_susdcnh: { value: 1, date: 17, time: 0 },
  globalbd_cn10yt: { value: 1, date: 12 },
};

/** 新浪 quote lines (`var hq_str_X="…";`), Beijing date and time converted to the New York day where `time` is given. */
export function parseSinaLatest(text: string): Map<string, LatestQuote> {
  const map = new Map<string, LatestQuote>();
  for (const m of text.matchAll(/hq_str_(\w+)="([^"]*)"/g)) {
    const fields = SINA_FIELDS[m[1]];
    const parts = m[2].split(",");
    if (!fields || parts.length <= fields.date) continue;
    const value = Number(parts[fields.value]);
    const stamp = parts[fields.date].match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?/);
    if (!stamp || !Number.isFinite(value) || value <= 0) continue;
    let date = `${stamp[1]}-${stamp[2]}-${stamp[3]}`;
    const clock = fields.time !== undefined ? parts[fields.time]?.match(/^(\d{2}):(\d{2})/) : null;
    if (clock) date = nyDay(zonedTimeToUtc(+stamp[1], +stamp[2], +stamp[3], +clock[1], +clock[2], "Asia/Shanghai").getTime());
    map.set(m[1], { date: weekdayOf(date), value });
  }
  return map;
}

export async function fetchSinaLatest(symbols: string[]): Promise<Map<string, LatestQuote>> {
  const text = await fetchText(`https://hq.sinajs.cn/list=${symbols.join(",")}`, { headers: { Referer: "https://finance.sina.com.cn/" } });
  const map = parseSinaLatest(text);
  if (!map.size) throw new Error("没有返回行情");
  return map;
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
  close?: number | null;
  peg?: number | null;
}

/** A PE percentile over a shorter history says little. */
const MIN_PERCENTILE_YEARS = 5;

const csindexDate = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

/**
 * 中证指数's daily index performance since 2016: closes, and `peg`, the index PE it publishes. The PE
 * percentile is computed when the PE history covers five years.
 */
export function parseCsindex(body: { data?: CsindexRow[] }): { closes: Close[]; valuation: Valuation } {
  const rows = body.data ?? [];
  const closes = rows.filter((r) => typeof r.close === "number" && r.close > 0).map((r) => [csindexDate(r.tradeDate), r.close!] as Close);
  const pes = rows.filter((r) => typeof r.peg === "number" && r.peg > 0);
  const last = pes.at(-1);
  if (!last) throw new Error("没有返回市盈率");
  const valuation: Valuation = { pe: last.peg!, date: csindexDate(last.tradeDate), source: "中证指数" };
  const since = csindexDate(pes[0].tradeDate);
  if ((Date.parse(valuation.date) - Date.parse(since)) / (365.25 * 86_400_000) >= MIN_PERCENTILE_YEARS) {
    valuation.pePercentile = Math.round((pes.filter((r) => r.peg! <= last.peg!).length / pes.length) * 10_000) / 10_000;
    valuation.since = since;
  }
  return { closes, valuation };
}

/** `days` limits the range when only recent closes are needed; the default covers the PE history since 2016. */
export async function fetchCsindex(code: string, now = new Date(), days?: number): Promise<{ closes: Close[]; valuation: Valuation }> {
  const end = dayKey(now).replace(/-/g, "");
  const start = days ? dayKey(now.getTime() - days * 86_400_000).replace(/-/g, "") : "20160101";
  const url = `https://www.csindex.com.cn/csindex-home/perf/index-perf?indexCode=${code}&startDate=${start}&endDate=${end}`;
  return parseCsindex(await fetchJson(url, { headers: { Referer: "https://www.csindex.com.cn/" }, timeoutMs: 60_000 }));
}
