import { describe, expect, it } from "vitest";
import { dayKey, formatClock, formatDay, relativeDayLabel, zonedTimeToUtc } from "@/lib/time";

describe("Beijing time helpers", () => {
  it("groups by Beijing date", () => {
    expect(dayKey("2026-10-28T15:59:00Z")).toBe("2026-10-28");
    expect(dayKey("2026-10-28T16:00:00Z")).toBe("2026-10-29");
  });

  it("formats clock and day labels", () => {
    expect(formatClock("2026-10-29T00:05:00Z")).toBe("08:05");
    expect(formatDay("2026-10-29")).toBe("10月29日 周四");
  });

  it("converts Beijing wall-clock time to UTC", () => {
    expect(zonedTimeToUtc(2026, 10, 29, 10, 53, "Asia/Shanghai").toISOString()).toBe("2026-10-29T02:53:00.000Z");
    expect(zonedTimeToUtc(2026, 10, 28, 9, 0, "America/Los_Angeles").toISOString()).toBe("2026-10-28T16:00:00.000Z");
  });

  it("labels today and yesterday", () => {
    const now = new Date("2026-10-29T04:00:00Z");
    expect(relativeDayLabel("2026-10-29", now)).toBe("今天");
    expect(relativeDayLabel("2026-10-28", now)).toBe("昨天");
    expect(relativeDayLabel("2026-10-20", now)).toBeNull();
  });
});
