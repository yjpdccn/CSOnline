import { fetchJson, fetchText } from "@/lib/pipeline/http";
import { zonedTimeToUtc, zonedParts } from "@/lib/time";
import type { CalendarEvent } from "../types";

export interface WscnCalendarItem {
  id: number;
  public_date: number;
  country: string;
  title: string;
  importance: number;
  calendar_type?: string;
  previous?: string;
  forecast?: string;
  actual?: string;
  unit?: string;
  uri?: string;
}

const KEY_COUNTRIES = new Set(["美国", "中国"]);
const RATE_DECISION = /利率决议|主要再融资利率|政策利率|存款便利利率|贷款市场报价利率|LPR/;
const POLICY_EVENT =
  /央行|利率决议|议息|美联储|FOMC|鲍威尔|沃什|政治局|国常会|国务院常务|全国人大|人大常委会|中央经济工作会议|两会|国新办|休市|冬令时|夏令时|中期选举|大选|OPEC|外汇储备/;

/** 华尔街见闻 puts events without a time of day at 12:02 Beijing time. */
function unknownTime(unix: number): boolean {
  const p = zonedParts(unix * 1000);
  return p.hour === 12 && p.minute === 2;
}

/**
 * Keeps what moves the tracked markets: important US and China data, central-bank rate decisions,
 * and policy events. Releases at the same minute from one country become one event.
 */
export function selectCalendarEvents(items: WscnCalendarItem[]): CalendarEvent[] {
  const kept = items.filter((item) => {
    const data = item.calendar_type !== "FE";
    if (data) return (KEY_COUNTRIES.has(item.country) && item.importance >= 3) || (RATE_DECISION.test(item.title) && item.importance >= 3);
    return item.importance >= 3 && POLICY_EVENT.test(item.title);
  });
  const groups = new Map<string, WscnCalendarItem[]>();
  for (const item of kept) {
    const key = `${item.country}|${item.public_date}|${item.calendar_type === "FE" ? item.id : "data"}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()]
    .map((group) => {
      const sorted = [...group].sort((a, b) => b.importance - a.importance);
      const top = sorted[0];
      const event: CalendarEvent = {
        id: `wscn-${top.id}`,
        at: new Date(top.public_date * 1000).toISOString(),
        country: top.country,
        title: sorted.slice(0, 3).map((i) => i.title).join(" · ") + (sorted.length > 3 ? ` 等 ${sorted.length} 项` : ""),
        importance: top.importance,
        kind: top.calendar_type === "FE" ? "event" : "data",
        source: "华尔街见闻",
      };
      if (unknownTime(top.public_date)) event.dateOnly = true;
      if (top.previous) event.previous = top.previous;
      if (top.forecast) event.forecast = top.forecast;
      if (top.actual) event.actual = top.actual;
      if (top.unit) event.unit = top.unit;
      return event;
    })
    .sort((a, b) => a.at.localeCompare(b.at));
}

export async function fetchWscnCalendar(now: Date, days: number): Promise<CalendarEvent[]> {
  const start = Math.floor(now.getTime() / 1000) - 6 * 3600;
  const end = start + days * 86_400;
  const body = await fetchJson<{ data?: { items?: WscnCalendarItem[] } }>(
    `https://api-one-wscn.awtmt.com/apiv1/finance/macrodatas?start=${start}&end=${end}`,
    { timeoutMs: 40_000 },
  );
  const items = body.data?.items;
  if (!items?.length) throw new Error("没有返回日历");
  return selectCalendarEvents(items);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * FOMC statement times from the Fed's meeting calendar: 2 p.m. Eastern on the last day of each meeting.
 * Dates like "27-28", "17-18*" (with projections) or "Apr/May 30-1".
 */
export function parseFomcCalendar(html: string): string[] {
  const times: string[] = [];
  const sections = html.split(/<h4><a id="\d+">/).slice(1);
  for (const section of sections) {
    const year = Number(section.match(/^(\d{4}) FOMC Meetings/)?.[1]);
    if (!year) continue;
    const re = /fomc-meeting__month[^>]*>\s*<strong>([^<]+)<\/strong>\s*<\/div>\s*<div class="fomc-meeting__date[^>]*>([^<]+)<\/div>/g;
    for (const m of section.matchAll(re)) {
      const monthText = m[1].trim();
      const dayText = m[2].replace(/\*/g, "").trim();
      if (/notation|unscheduled|cancel/i.test(dayText)) continue;
      const months = monthText.split("/").map((name) => MONTHS.findIndex((full) => full.startsWith(name.trim().slice(0, 3))));
      const days = dayText.split("-").map((d) => Number(d.trim()));
      const lastDay = days.at(-1);
      const month = months.at(-1);
      if (!lastDay || month === undefined || month < 0) continue;
      times.push(zonedTimeToUtc(year, month + 1, lastDay, 14, 0, "America/New_York").toISOString());
    }
  }
  return [...new Set(times)].sort();
}

export async function fetchFomcCalendar(now: Date): Promise<string[]> {
  const all = parseFomcCalendar(await fetchText("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"));
  const upcoming = all.filter((t) => Date.parse(t) >= now.getTime() - 12 * 3600_000);
  if (!all.length) throw new Error("页面中没有会议日期");
  return upcoming.slice(0, 4);
}
