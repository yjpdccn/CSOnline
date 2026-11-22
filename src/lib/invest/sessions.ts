import { EARLY_CLOSES } from "@/config/market-calendar";
import { zonedTimeToUtc } from "@/lib/time";
import type { Close } from "./types";

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
