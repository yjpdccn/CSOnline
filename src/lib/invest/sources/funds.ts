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
  return parseNavHistory(await fetchJson<LsjzResponse>(url, { headers: F10_HEADERS }));
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

export async function fetchFeePage(code: string): Promise<FeePage> {
  return parseFeePage(await fetchText(`https://fundf10.eastmoney.com/jjfl_${code}.html`, { headers: F10_HEADERS }));
}

export interface ProfilePage {
  name?: string;
  type?: string;
  index?: string;
  benchmark?: string;
}

/** 基本概况 page (jbgk): name, type, 跟踪标的 and 业绩比较基准. */
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
  if (!profile.name && !profile.type) throw new Error("页面中没有基金概况");
  return profile;
}

export async function fetchProfilePage(code: string): Promise<ProfilePage> {
  return parseProfilePage(await fetchText(`https://fundf10.eastmoney.com/jbgk_${code}.html`, { headers: F10_HEADERS }));
}
