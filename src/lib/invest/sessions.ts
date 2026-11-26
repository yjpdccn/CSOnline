import { EARLY_CLOSES, HOLIDAYS, type HolidayMarket } from "@/config/market-calendar";
import { dayKey, shiftDay, zonedParts, zonedTimeToUtc } from "@/lib/time";
import type { Close } from "./types";

const openInChina = (day: string) => {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !HOLIDAYS.cn.includes(day);
};

/** The China business day a fund order placed at `at` counts for: that day before the 15:00 Beijing cut-off, else the next. */
export function orderDay(at: Date | string): string {
  let day = dayKey(at);
  if (!openInChina(day) || zonedParts(at).hour >= 15) {
    do day = shiftDay(day, 1);
    while (!openInChina(day));
  }
  return day;
}

export interface OverseasHoliday {
  day: string;
  market: HolidayMarket;
}

/** The holiday in one of `markets` that an order placed at `at` falls on, if any. */
export function holidayOrder(at: Date | string, markets: readonly HolidayMarket[]): OverseasHoliday | undefined {
  const day = orderDay(at);
  const market = markets.find((m) => HOLIDAYS[m].includes(day));
  return market ? { day, market } : undefined;
}

/** Vendors post the closing value a little after the bell, and their delayed US quotes lag up to 15 minutes. */
const SETTLE_MS = 60 * 60_000;

/** When a New York trading day's session ends: 16:00, or 13:00 on early-close days; DST comes from the time zone. */
export function usCloseAt(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return zonedTimeToUtc(y, m, d, EARLY_CLOSES.us.includes(day) ? 13 : 16, 0, "America/New_York");
}

/** The bars of US sessions that had closed when the data was fetched: a mid-session price is not a close. */
export function settledUsCloses(closes: Close[], fetchedAt: Date | string): Close[] {
  const at = new Date(fetchedAt).getTime();
  return closes.filter(([day]) => usCloseAt(day).getTime() + SETTLE_MS <= at);
}
