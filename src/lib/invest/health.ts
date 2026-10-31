import { FUNDS, INDICES, MACRO, type IndexId, type MacroId } from "@/config/invest";
import { AVAILABILITY, HOLIDAYS, type Availability, type MarketCalendar } from "@/config/market-calendar";
import { formatDateTime, shiftDay, zonedTimeToUtc } from "@/lib/time";
import type { StrategyFile } from "./strategy";
import type { DataIssue, FundsFile, HealthFile, HealthGroup, HealthGroupId, HealthItem, InvestSourceResult, MarketFile, NewsFile, CalendarFile } from "./types";

export const HEALTH_GROUPS: Record<HealthGroupId, string> = {
  indices: "指数行情",
  gold: "黄金",
  macro: "利率与汇率",
  etf: "场内价格",
  nav: "基金净值",
  fundInfo: "申购状态与费率",
  valuation: "估值",
  news: "新闻",
  calendar: "财经日历",
  strategy: "同类基金比较与公告",
};

/** The comparison runs weekly; past this it may name funds whose fees or quotas have moved. */
const STRATEGY_MAX_AGE_MS = 9 * 86_400_000;

function isBusinessDay(day: string, calendar: MarketCalendar): boolean {
  const [y, m, d] = day.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return calendar === "fx" || !HOLIDAYS[calendar].includes(day);
}

function dayIn(tz: string, time: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(time);
}

/** The newest trading day whose figure should be out by `now`, after the usual publication lag. */
export function expectedDate(avail: Availability, now: Date): string {
  let day = dayIn(avail.tz, now.getTime());
  for (let i = 0; i < 40; i++) {
    if (isBusinessDay(day, avail.calendar)) {
      const [y, m, d] = day.split("-").map(Number);
      const ready = zonedTimeToUtc(y, m, d, Math.floor(avail.readyHour), Math.round((avail.readyHour % 1) * 60), avail.tz);
      if (ready.getTime() <= now.getTime()) break;
    }
    day = shiftDay(day, -1);
  }
  for (let k = 0; k < (avail.lagDays ?? 0); k++) {
    do day = shiftDay(day, -1);
    while (!isBusinessDay(day, avail.calendar));
  }
  return day;
}

const short = (day: string) => `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`;

/** What a run fetched, for telling fresh figures from ones carried over from earlier runs. */
export interface RunFreshness {
  series: Set<string>;
  prices: Set<string>;
  navs: Set<string>;
  feePages: Set<string>;
  valuations: Set<string>;
  /** Fresh data rejected for jumping implausibly: item key → reason. */
  implausible: Map<string, string>;
  sources: InvestSourceResult[];
}

interface Figure {
  key: string;
  group: HealthGroupId;
  name: string;
  avail: Availability;
  latest?: string;
  /** Latest one-day move: a fraction, or percentage points for yields. */
  move?: number;
  maxMove: number;
  yieldSeries?: boolean;
  refreshed: boolean;
}

const QDII = (code: string) => {
  const fund = FUNDS.find((f) => f.code === code);
  return INDICES.find((i) => i.id === fund?.index)?.market === "us";
};

function seriesFigure(market: MarketFile, id: IndexId | MacroId, group: HealthGroupId, name: string, avail: Availability, maxMove: number, yieldSeries: boolean, fresh: RunFreshness): Figure {
  const closes = market.series[id]?.closes ?? [];
  const [last, prev] = [closes.at(-1), closes.at(-2)];
  const move = last && prev ? (yieldSeries ? last[1] - prev[1] : last[1] / prev[1] - 1) : undefined;
  return { key: id, group, name, avail, latest: last?.[0], move, maxMove, yieldSeries, refreshed: fresh.series.has(id) };
}

function figures(market: MarketFile, funds: FundsFile, fresh: RunFreshness): Figure[] {
  const out: Figure[] = [];
  for (const index of INDICES) {
    if (index.id === "gold") {
      out.push(seriesFigure(market, "gold", "gold", "黄金9999", AVAILABILITY.sge, 0.1, false, fresh));
    } else if (index.id === "cnbond") {
      out.push(seriesFigure(market, "cnbond", "macro", index.name, AVAILABILITY.cnBond, 0.5, true, fresh));
    } else {
      out.push(seriesFigure(market, index.id, "indices", index.name, index.market === "us" ? AVAILABILITY.usClose : AVAILABILITY.cnClose, 0.1, false, fresh));
    }
  }
  for (const m of MACRO) {
    const avail = m.id === "shau" ? AVAILABILITY.sge : m.id === "real10y" ? AVAILABILITY.treasury : AVAILABILITY.fx;
    const group: HealthGroupId = m.id === "xau" || m.id === "shau" ? "gold" : "macro";
    const maxMove = m.yieldSeries ? 0.5 : group === "gold" ? 0.1 : 0.03;
    out.push(seriesFigure(market, m.id, group, m.name, avail, maxMove, Boolean(m.yieldSeries), fresh));
  }
  for (const fund of FUNDS) {
    const data = funds.funds[fund.code];
    if (fund.etf || fund.lof) {
      const prices = data?.prices ?? [];
      const [last, prev] = [prices.at(-1), prices.at(-2)];
      out.push({
        key: `price:${fund.code}`,
        group: "etf",
        name: `${fund.code} 场内价`,
        avail: AVAILABILITY.cnClose,
        latest: last?.[0],
        move: last && prev ? last[1] / prev[1] - 1 : undefined,
        maxMove: 0.1,
        refreshed: fresh.prices.has(fund.code),
      });
    }
    const nav = data?.navs?.[0];
    const bond = /债/.test(data?.type ?? fund.name);
    out.push({
      key: `nav:${fund.code}`,
      group: "nav",
      name: `${fund.code} 净值`,
      avail: QDII(fund.code) ? AVAILABILITY.navQdii : AVAILABILITY.navDomestic,
      latest: nav?.date,
      move: nav?.changePct !== undefined ? nav.changePct / 100 : undefined,
      maxMove: bond ? 0.02 : 0.1,
      refreshed: fresh.navs.has(fund.code),
    });
  }
  return out;
}

const pct = (move: number) => `${move > 0 ? "+" : ""}${(move * 100).toFixed(1)}%`;

const named = (list: { name: string; latest?: string }[]) =>
  list.map((s) => (s.latest ? `${s.name}（停在 ${short(s.latest.slice(0, 10))}）` : `${s.name}（没有数据）`)).join("、");

/** Status and fees are read every run; this old means the pages failed run after run. */
const INFO_MAX_AGE_MS = 36 * 3600_000;

type Checked = Figure & { expected: string };

/**
 * Checks every figure the page shows: stale against its market's calendar, implausible jumps, and items or
 * sources that gave nothing this run. A refreshed figure behind its expected date still counts as current
 * when another refreshed figure on the same calendar stops at the same date and none is newer: the market
 * was closed on a day HOLIDAYS does not list.
 */
export function checkHealth(
  input: { market: MarketFile; funds: FundsFile; news: NewsFile; calendar: CalendarFile; strategy?: StrategyFile },
  fresh: RunFreshness,
  previous: { groups?: Partial<Record<HealthGroupId, { lastSuccess?: string }>> } | null,
  now: Date,
): HealthFile {
  const at = now.toISOString();
  const issues: DataIssue[] = [];
  const items = new Map<HealthGroupId, HealthItem[]>(Object.keys(HEALTH_GROUPS).map((g) => [g as HealthGroupId, []]));
  const all: Checked[] = figures(input.market, input.funds, fresh).map((f) => ({ ...f, expected: expectedDate(f.avail, now) }));

  // Dates past the expected one are capped: the gold exchange's night session counts toward the next trading day.
  const calendarKey = (f: Checked) => `${f.avail.calendar}|${f.avail.lagDays ?? 0}`;
  const reached = (f: Checked) => (f.latest! < f.expected ? f.latest! : f.expected);
  const newest = new Map<string, string>();
  for (const f of all) {
    if (f.refreshed && f.latest && reached(f) > (newest.get(calendarKey(f)) ?? "")) newest.set(calendarKey(f), reached(f));
  }
  const agreeing = new Map<string, number>();
  for (const f of all) {
    if (f.refreshed && f.latest && reached(f) === newest.get(calendarKey(f))) agreeing.set(calendarKey(f), (agreeing.get(calendarKey(f)) ?? 0) + 1);
  }
  const marketClosed = (f: Checked) => f.refreshed && reached(f) === newest.get(calendarKey(f)) && (agreeing.get(calendarKey(f)) ?? 0) >= 2;

  const stale = new Map<HealthGroupId, Checked[]>();
  const missed = new Map<HealthGroupId, Checked[]>();
  const add = (map: Map<HealthGroupId, Checked[]>, f: Checked) => map.set(f.group, [...(map.get(f.group) ?? []), f]);
  for (const f of all) {
    const isStale = !f.latest || (f.latest < f.expected && !marketClosed(f));
    items.get(f.group)!.push({ key: f.key, name: f.name, latest: f.latest, expected: f.expected, refreshed: f.refreshed, stale: isStale });
    const rejected = fresh.implausible.get(f.key);
    if (isStale) add(stale, f);
    else if (!f.refreshed && !rejected) add(missed, f);
    if (rejected) {
      issues.push({ key: `implausible:${f.key}`, group: f.group, kind: "implausible", severity: "warn", message: `${f.name}：${rejected}，未采用，页面显示上次的数据`, items: [f.name] });
    } else if (f.move !== undefined && Math.abs(f.move) > f.maxMove) {
      const moved = f.yieldSeries ? `${f.move > 0 ? "+" : ""}${Math.round(f.move * 100)}bp` : pct(f.move);
      issues.push({ key: `move:${f.key}`, group: f.group, kind: "move", severity: "warn", message: `${f.name} 单日变动 ${moved}，超出常见范围，请核对是否为数据错误`, items: [f.name] });
    }
  }
  for (const [group, list] of stale) {
    issues.push({ key: `stale:${group}`, group, kind: "stale", severity: "warn", message: `${HEALTH_GROUPS[group]}没有更新到最新交易日：${named(list)}`, items: list.map((f) => f.name) });
  }
  for (const [group, list] of missed) {
    issues.push({
      key: `failed:${group}`,
      group,
      kind: "failed",
      severity: "minor",
      message: `${HEALTH_GROUPS[group]}本次没有取到新数据：${list.map((f) => f.name).join("、")}，页面上的仍是最新交易日的数值`,
      items: list.map((f) => f.name),
    });
  }

  for (const fund of FUNDS) {
    const data = input.funds.funds[fund.code];
    const asOf = data?.status?.asOf ?? data?.fees?.asOf;
    const old = !asOf || now.getTime() - Date.parse(asOf) > INFO_MAX_AGE_MS;
    items.get("fundInfo")!.push({ key: `info:${fund.code}`, name: `${fund.code} 申购状态与费率`, latest: asOf, refreshed: fresh.feePages.has(fund.code), stale: old });
  }
  const codes = (list: HealthItem[]) => list.map((i) => i.name.split(" ")[0]).join("、");
  const info = items.get("fundInfo")!;
  const oldInfo = info.filter((i) => i.stale);
  if (oldInfo.length) {
    issues.push({
      key: "stale:fundInfo",
      group: "fundInfo",
      kind: "stale",
      severity: "warn",
      message: `申购状态与费率超过 36 小时没有读到：${codes(oldInfo)}，相关提醒可能滞后`,
      items: oldInfo.map((i) => i.name),
    });
  }
  const missedInfo = info.filter((i) => !i.stale && !i.refreshed);
  if (missedInfo.length) {
    issues.push({
      key: "failed:fundInfo",
      group: "fundInfo",
      kind: "failed",
      severity: "minor",
      message: `申购状态与费率本次没有读到：${codes(missedInfo)}，沿用上次读到的结果`,
      items: missedInfo.map((i) => i.name),
    });
  }

  for (const index of INDICES) {
    if (!index.valuation) continue;
    const v = input.market.valuations[index.id];
    const expected = expectedDate({ ...AVAILABILITY.valuation, calendar: (index.market === "us" ? "us" : "cn") as MarketCalendar }, now);
    items.get("valuation")!.push({ key: `valuation:${index.id}`, name: `${index.name} 估值`, latest: v?.date, expected, refreshed: fresh.valuations.has(index.id), stale: !v || v.date < expected });
  }
  // PE/PB carry their date on the page and change slowly: worth listing, not worth a banner.
  const valuations = items.get("valuation")!;
  const oldValuations = valuations.filter((i) => i.stale);
  if (oldValuations.length) {
    issues.push({ key: "stale:valuation", group: "valuation", kind: "stale", severity: "minor", message: `估值没有更新：${named(oldValuations)}`, items: oldValuations.map((i) => i.name) });
  }
  const missedValuations = valuations.filter((i) => !i.stale && !i.refreshed);
  if (missedValuations.length) {
    issues.push({
      key: "failed:valuation",
      group: "valuation",
      kind: "failed",
      severity: "minor",
      message: `估值本次没有取到新数据：${missedValuations.map((i) => i.name).join("、")}，沿用上次的数值`,
      items: missedValuations.map((i) => i.name),
    });
  }

  const newsSources = fresh.sources.filter((s) => s.kind === "新闻");
  const allNewsFailed = newsSources.length > 0 && newsSources.every((s) => !s.ok);
  for (const s of newsSources) {
    items.get("news")!.push({ key: `source:${s.id}`, name: s.name, refreshed: s.ok, stale: !s.ok });
    if (!s.ok && !allNewsFailed) {
      issues.push({ key: `failed:source:${s.id}`, group: "news", kind: "failed", severity: "minor", message: `新闻来源 ${s.name} 本次没有抓到：${s.error ?? "失败"}`, items: [s.name] });
    }
  }
  if (allNewsFailed) {
    issues.push({ key: "failed:news", group: "news", kind: "failed", severity: "warn", message: "新闻来源本次全部没有抓到，要闻停在上次更新", items: newsSources.map((s) => s.name) });
  }
  const newestNews = input.news.items.reduce((t, i) => (i.publishedAt > t ? i.publishedAt : t), "");
  if (!newestNews || now.getTime() - Date.parse(newestNews) > 24 * 3600_000) {
    issues.push({ key: "stale:news", group: "news", kind: "stale", severity: "warn", message: `超过 24 小时没有新的要闻${newestNews ? `（最新一条 ${formatDateTime(newestNews)}）` : ""}`, items: ["新闻"] });
  }

  for (const s of fresh.sources.filter((r) => r.kind === "日历")) {
    items.get("calendar")!.push({ key: `source:${s.id}`, name: s.name, refreshed: s.ok, stale: !s.ok });
    if (!s.ok) {
      issues.push({ key: `failed:source:${s.id}`, group: "calendar", kind: "failed", severity: "minor", message: `${s.name} 本次没有抓到：${s.error ?? "失败"}，日历沿用上次的数据`, items: [s.name] });
    }
  }
  const calendarAt = input.calendar.updatedAt;
  if (!calendarAt || now.getTime() - Date.parse(calendarAt) > INFO_MAX_AGE_MS) {
    issues.push({
      key: "stale:calendar",
      group: "calendar",
      kind: "stale",
      severity: "warn",
      message: `财经日历超过 36 小时没有更新${calendarAt ? `（上次 ${formatDateTime(calendarAt)}）` : ""}，近期的数据发布可能缺失`,
      items: ["财经日历"],
    });
  }

  // Suggestions rest on the weekly comparison and this run's announcements; neither changes the numbers shown.
  if (input.strategy) {
    const { checkedAt, noticesAt } = input.strategy;
    const old = !checkedAt || now.getTime() - Date.parse(checkedAt) > STRATEGY_MAX_AGE_MS;
    items.get("strategy")!.push({ key: "peers", name: "同类基金比较", latest: checkedAt, refreshed: fresh.sources.some((s) => s.id === "fund-peers" && s.ok), stale: old });
    items.get("strategy")!.push({ key: "notices", name: "基金公告", latest: noticesAt, refreshed: fresh.sources.some((s) => s.id === "fund-notices" && s.ok), stale: !noticesAt });
    if (old) {
      issues.push({
        key: "stale:strategy",
        group: "strategy",
        kind: "stale",
        severity: "minor",
        message: checkedAt ? `同类基金比较停在 ${formatDateTime(checkedAt)}，替换和加大的建议可能过时` : "还没有完成同类基金比较，暂时没有替换建议",
        items: ["同类基金比较"],
      });
    }
    for (const s of fresh.sources.filter((r) => ["fund-peers", "fund-notices", "peer-status"].includes(r.id) && (!r.ok || r.error))) {
      issues.push({ key: `failed:source:${s.id}`, group: "strategy", kind: "failed", severity: "minor", message: `${s.name}${s.ok ? "部分" : ""}没有读到：${s.error ?? "失败"}`, items: [s.name] });
    }
  }

  const answered = (kind: string) => fresh.sources.some((s) => s.kind === kind && s.ok);
  const groups = {} as Record<HealthGroupId, HealthGroup>;
  for (const [id, label] of Object.entries(HEALTH_GROUPS) as [HealthGroupId, string][]) {
    const own = issues.filter((i) => i.group === id);
    const ok = !own.some((i) => i.severity === "warn");
    // News and the calendar have several sources: one failing still leaves the group up to date.
    const updated = id === "news" ? ok && answered("新闻") : id === "calendar" ? ok && answered("日历") : own.length === 0;
    const lastSuccess = updated ? at : previous?.groups?.[id]?.lastSuccess;
    groups[id] = { label, ok, ...(lastSuccess ? { lastSuccess } : {}), items: items.get(id)! };
  }
  issues.sort((a, b) => Number(a.severity === "minor") - Number(b.severity === "minor"));
  return { checkedAt: at, groups, issues };
}
