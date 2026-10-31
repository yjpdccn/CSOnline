import { load } from "cheerio";
import { fetchJson, fetchText } from "@/lib/pipeline/http";
import { collapse } from "@/lib/pipeline/text";
import type { FundFees, FundStatus, NavPoint } from "../types";

const F10_HEADERS = { Referer: "https://fundf10.eastmoney.com/" };

interface LsjzResponse {
  Data?: { LSJZList?: { FSRQ: string; DWJZ: string; JZZZL?: string }[] } | null;
  ErrCode?: number;
}

/** 天天基金 NAV history, latest first. */
export function parseNavHistory(body: LsjzResponse): NavPoint[] {
  const rows = body.Data?.LSJZList ?? [];
  const navs = rows.flatMap((row) => {
    const nav = Number(row.DWJZ);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.FSRQ) || !Number.isFinite(nav) || nav <= 0) return [];
    const change = row.JZZZL === undefined || row.JZZZL === "" ? NaN : Number(row.JZZZL);
    const point: NavPoint = { date: row.FSRQ, nav };
    if (Number.isFinite(change)) point.changePct = change;
    return [point];
  });
  if (!navs.length) throw new Error("没有返回净值");
  return navs;
}

export async function fetchNavHistory(code: string, size = 30): Promise<NavPoint[]> {
  const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=${size}`;
  return parseNavHistory(await fetchJson<LsjzResponse>(url, { headers: F10_HEADERS, retries: 2 }));
}

interface MobileBaseResponse {
  Datas?: { FSRQ?: string; DWJZ?: string; RZDF?: string } | null;
}

/** 天天基金's app API: the latest NAV only, on another host, for when the history API times out. */
export function parseMobileNav(body: MobileBaseResponse): NavPoint {
  const d = body.Datas;
  const nav = Number(d?.DWJZ);
  if (!d?.FSRQ || !/^\d{4}-\d{2}-\d{2}$/.test(d.FSRQ) || !Number.isFinite(nav) || nav <= 0) throw new Error("没有返回净值");
  const point: NavPoint = { date: d.FSRQ, nav };
  const change = Number(d.RZDF);
  if (d.RZDF !== undefined && d.RZDF !== "" && Number.isFinite(change)) point.changePct = change;
  return point;
}

export async function fetchMobileNav(code: string): Promise<NavPoint> {
  const url = `https://fundmobapi.eastmoney.com/FundMApi/FundBaseTypeInformation.ashx?FCODE=${code}&deviceid=Wap&plat=Wap&product=EFund&version=2.0.0`;
  return parseMobileNav(await fetchJson<MobileBaseResponse>(url));
}

/** Label/value cells of a 天天基金 F10 page: `<td class="th">label</td><td>value</td>` or `<th>label</th><td>value</td>`. */
function labelledCells(html: string): Map<string, string> {
  const $ = load(html);
  const cells = new Map<string, string>();
  $("td.th, th").each((_, el) => {
    const label = collapse($(el).text());
    const value = collapse($(el).next("td").text());
    if (label && value && !cells.has(label)) cells.set(label, value);
  });
  return cells;
}

const percent = (text: string | undefined): number | undefined => {
  const m = text?.match(/(\d+(?:\.\d+)?)%/);
  return m ? Number(m[1]) : undefined;
};

/** "10.00元" → 10, "7500.00万元" → 75,000,000, "无限额" → null. */
export function parseLimit(text: string | undefined): number | null | undefined {
  if (!text) return undefined;
  if (/无限额|不限/.test(text)) return null;
  const m = text.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(万|亿)?元/);
  if (!m) return undefined;
  return Number(m[1]) * (m[2] === "亿" ? 1e8 : m[2] === "万" ? 1e4 : 1);
}

export interface FeePage {
  status?: FundStatus;
  fees: FundFees;
}

/** 基金费率 page (jjfl): 交易状态, 日累计申购限额 and 运作费用. */
export function parseFeePage(html: string): FeePage {
  const cells = labelledCells(html);
  const purchase = cells.get("申购状态");
  const status: FundStatus | undefined = purchase ? { purchase } : undefined;
  if (status) {
    const redeem = cells.get("赎回状态");
    const dca = cells.get("定投状态");
    const limit = parseLimit(cells.get("日累计申购限额"));
    if (redeem) status.redeem = redeem;
    if (dca) status.dca = dca;
    if (limit !== undefined) status.limit = limit;
  }
  const fees: FundFees = {};
  const management = percent(cells.get("管理费率"));
  const custody = percent(cells.get("托管费率"));
  const service = percent(cells.get("销售服务费率"));
  if (management !== undefined) fees.management = management;
  if (custody !== undefined) fees.custody = custody;
  if (service !== undefined) fees.service = service;
  if (!status && fees.management === undefined) throw new Error("页面中没有交易状态和费率");
  return { status, fees };
}

export async function fetchFeePage(code: string, retries = 1): Promise<FeePage> {
  return parseFeePage(await fetchText(`https://fundf10.eastmoney.com/jjfl_${code}.html`, { headers: F10_HEADERS, retries }));
}

export interface ProfilePage {
  name?: string;
  type?: string;
  index?: string;
  benchmark?: string;
  /** 成立日期, YYYY-MM-DD. */
  established?: string;
  /** 净资产规模 of this share class in yuan, and the report date it is from. */
  size?: number;
  sizeDate?: string;
  fees?: FundFees;
}

const chineseDate = (text: string | undefined) => {
  const m = text?.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : undefined;
};

/** "28.47亿元（截止至：2026年09月30日）" → 2,847,000,000; "--" → undefined. */
export function parseAmount(text: string | undefined): number | undefined {
  const m = text?.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(亿|万)?元/);
  return m ? Math.round(Number(m[1]) * (m[2] === "亿" ? 1e8 : m[2] === "万" ? 1e4 : 1)) : undefined;
}

/** 基本概况 page (jbgk): name, type, 跟踪标的, 业绩比较基准, 成立日期, 净资产规模 and 运作费用. */
export function parseProfilePage(html: string): ProfilePage {
  const cells = labelledCells(html);
  const profile: ProfilePage = {};
  const name = cells.get("基金简称");
  const type = cells.get("基金类型");
  const index = cells.get("跟踪标的");
  const benchmark = cells.get("业绩比较基准");
  if (name) profile.name = name;
  if (type) profile.type = type;
  if (index && !/无跟踪标的/.test(index)) profile.index = index;
  if (benchmark) profile.benchmark = benchmark;
  const established = chineseDate(cells.get("成立日期/规模"));
  if (established) profile.established = established;
  const size = cells.get("净资产规模");
  const amount = parseAmount(size);
  if (amount !== undefined) {
    profile.size = amount;
    const asOf = chineseDate(size);
    if (asOf) profile.sizeDate = asOf;
  }
  const fees: FundFees = {};
  const management = percent(cells.get("管理费率"));
  const custody = percent(cells.get("托管费率"));
  const service = percent(cells.get("销售服务费率"));
  if (management !== undefined) fees.management = management;
  if (custody !== undefined) fees.custody = custody;
  if (service !== undefined) fees.service = service;
  if (Object.keys(fees).length) profile.fees = fees;
  if (!profile.name && !profile.type) throw new Error("页面中没有基金概况");
  return profile;
}

export async function fetchProfilePage(code: string, retries = 1): Promise<ProfilePage> {
  return parseProfilePage(await fetchText(`https://fundf10.eastmoney.com/jbgk_${code}.html`, { headers: F10_HEADERS, retries }));
}

/** 特色数据 page (tsdata): annualized tracking error in percent; undefined for funds without an index. */
export function parseTrackingError(html: string): number | undefined {
  const $ = load(html);
  let value: number | undefined;
  $("table").each((_, table) => {
    const headers = $(table).find("th").map((__, th) => collapse($(th).text())).get();
    const column = headers.indexOf("年化跟踪误差");
    if (column < 0 || value !== undefined) return;
    const cell = $(table).find("tr").eq(1).find("td").eq(column).text();
    const pct = percent(cell);
    if (pct !== undefined) value = pct;
  });
  return value;
}

export async function fetchTrackingError(code: string): Promise<number | undefined> {
  return parseTrackingError(await fetchText(`https://fundf10.eastmoney.com/tsdata_${code}.html`, { headers: F10_HEADERS }));
}

export interface FundNotice {
  id: string;
  title: string;
  date: string;
}

/**
 * Announcements that can end or change a fund: 清盘 and 基金合同终止 (including the warning that a fund may hit
 * the line), 转型, 合并, a new benchmark or tracked index, and holder meetings that decide such things.
 * Notices about sales agents or market makers ("终止…销售业务") do not count.
 */
const MATERIAL_NOTICE =
  /清盘|基金财产清算|清算报告|基金合同终止|终止基金合同|转型|变更注册|吸收合并|基金合并|合并后|变更.{0,12}(?:业绩比较基准|标的指数|跟踪标的)|更换.{0,8}(?:标的指数|业绩比较基准)|标的指数.{0,6}更名|基金份额持有人大会/;

interface NoticeResponse {
  Data?: { TITLE?: string; PUBLISHDATEDesc?: string; ID?: string }[] | null;
}

export function parseNotices(body: NoticeResponse): FundNotice[] {
  if (!Array.isArray(body.Data)) throw new Error("没有返回公告列表");
  return body.Data.flatMap((row) => {
    if (!row.TITLE || !row.ID || !/^\d{4}-\d{2}-\d{2}$/.test(row.PUBLISHDATEDesc ?? "")) return [];
    return MATERIAL_NOTICE.test(row.TITLE) ? [{ id: row.ID, title: collapse(row.TITLE), date: row.PUBLISHDATEDesc! }] : [];
  });
}

/** The fund's latest announcements on 天天基金, filtered to the material ones. */
export async function fetchNotices(code: string): Promise<FundNotice[]> {
  const url = `https://api.fund.eastmoney.com/f10/JJGG?fundcode=${code}&pageIndex=1&pageSize=30&type=0`;
  return parseNotices(await fetchJson<NoticeResponse>(url, { headers: F10_HEADERS, retries: 1 }));
}

export interface UniverseFund {
  code: string;
  name: string;
  type: string;
}

/** 天天基金's list of every fund: `var r = [["000001","HXCZHH","华夏成长混合","混合型-灵活","…"],…];` */
export function parseFundUniverse(script: string): UniverseFund[] {
  const start = script.indexOf("[");
  const end = script.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("基金列表格式变了");
  const rows = JSON.parse(script.slice(start, end + 1)) as string[][];
  const funds = rows.flatMap((r) => (/^\d{6}$/.test(r[0] ?? "") && r[2] ? [{ code: r[0], name: r[2], type: r[3] ?? "" }] : []));
  if (funds.length < 1000) throw new Error(`基金列表只有 ${funds.length} 只`);
  return funds;
}

export async function fetchFundUniverse(): Promise<UniverseFund[]> {
  return parseFundUniverse(await fetchText("https://fund.eastmoney.com/js/fundcode_search.js", { retries: 1 }));
}

const CURRENCY = /[（(]?(?:人民币|美元现汇|美元现钞|美元汇|美元|美汇|美钞|现汇|现钞)[)）]?/g;

/**
 * Share class from a fund name: "摩根纳斯达克100指数(QDII)人民币A" → A, "华夏黄金ETF联接C" → C, "…联接Y" → Y; ""
 * for single-class funds. `stem` is the same for every class of a fund, currency classes included.
 */
export function shareClass(name: string): { stem: string; cls: string; usd: boolean } {
  const usd = /美元|美汇|美钞|现汇|现钞/.test(name);
  const bare = name.replace(CURRENCY, "").replace(/[（(][)）]/g, "").trim();
  const m = bare.match(/^(.*?)([A-Z])$/);
  return m && !/(?:ETF|LOF|QDII|FOF)$/.test(bare) ? { stem: m[1], cls: m[2], usd } : { stem: bare, cls: "", usd };
}
