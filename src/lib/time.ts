import { SITE } from "@/config/site";

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: SITE.timezone,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});

export function zonedParts(date: Date | string | number): ZonedParts {
  const d = date instanceof Date ? date : new Date(date);
  const parts = Object.fromEntries(
    partsFormatter.formatToParts(d).map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD in the site timezone. */
export function dayKey(date: Date | string | number): string {
  const p = zonedParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function formatClock(iso: string): string {
  const p = zonedParts(iso);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function formatDateTime(iso: string): string {
  const p = zonedParts(iso);
  return `${p.month}月${p.day}日 ${pad(p.hour)}:${pad(p.minute)}`;
}

/** "10月29日 周四" for a YYYY-MM-DD key. */
export function formatDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}月${d}日 ${WEEKDAYS[weekday]}`;
}

export function shiftDay(day: string, deltaDays: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** "今天" / "昨天" relative to now, or null. Only call on the client to avoid stale static output. */
export function relativeDayLabel(day: string, now = new Date()): string | null {
  const today = dayKey(now);
  if (day === today) return "今天";
  if (day === shiftDay(today, -1)) return "昨天";
  if (day === shiftDay(today, -2)) return "前天";
  return null;
}

export function formatRelative(iso: string, now = new Date()): string {
  const diff = now.getTime() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

/**
 * Converts a wall-clock time in an IANA timezone to a UTC Date.
 * Used for sources that publish "2026/10/29 10:53" (Beijing) or date-only values.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  timeZone: string = SITE.timezone,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const asZoned = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
  );
  return new Date(guess - (asZoned - guess));
}
