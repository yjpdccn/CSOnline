/**
 * Trading calendars for the data health check: a figure is stale only when the market traded and the figure
 * should be out. Weekends are closed everywhere; add each year's holidays here.
 *
 * - China (上交所/深交所/上金所): 2026 per the State Council schedule (matches the gaps in this year's index
 *   history). The 2027 schedule is published around November 2026; until it is added, an unlisted holiday is
 *   recognised when the figures fetched in the run stop on the same day (at least two, none newer).
 * - US (NYSE): 2026 and 2027.
 */
export const HOLIDAYS: Record<"cn" | "us", string[]> = {
  cn: [
    "2026-01-01", "2026-01-02",
    "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20", "2026-02-23",
    "2026-04-06",
    "2026-05-01", "2026-05-04", "2026-05-05",
    "2026-06-19",
    "2026-09-25",
    "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07",
    "2027-01-01",
  ],
  us: [
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
  ],
};

/** `fx` covers around-the-clock markets (gold, currencies, the dollar index): every weekday. */
export type MarketCalendar = "cn" | "us" | "fx";

/**
 * When a trading day's figure is out: `readyHour` in the market's timezone on that day, then `lagDays` more
 * business days for figures published late (QDII NAVs, valuations).
 */
export interface Availability {
  calendar: MarketCalendar;
  tz: "Asia/Shanghai" | "America/New_York";
  readyHour: number;
  lagDays?: number;
}

export const AVAILABILITY = {
  /** A-share indices and exchange-traded fund prices: close 15:00. */
  cnClose: { calendar: "cn", tz: "Asia/Shanghai", readyHour: 15.5 },
  /** 上海黄金交易所 Au99.99 and the 上海金 benchmark. */
  sge: { calendar: "cn", tz: "Asia/Shanghai", readyHour: 16 },
  /** China's 10-year yield. */
  cnBond: { calendar: "cn", tz: "Asia/Shanghai", readyHour: 17.5 },
  /** US indices: close 16:00 New York. */
  usClose: { calendar: "us", tz: "America/New_York", readyHour: 17 },
  /** Spot gold, currencies, the dollar index and US yields, dated by the New York day. */
  fx: { calendar: "fx", tz: "America/New_York", readyHour: 17 },
  /** The Treasury posts real yields in the evening; a day's delay is normal. */
  treasury: { calendar: "us", tz: "America/New_York", readyHour: 20, lagDays: 1 },
  /** Domestic fund NAVs come out the same evening. */
  navDomestic: { calendar: "cn", tz: "Asia/Shanghai", readyHour: 23 },
  /** QDII NAVs follow the overseas close and come out one to two days later. */
  navQdii: { calendar: "cn", tz: "Asia/Shanghai", readyHour: 23, lagDays: 2 },
  /** Valuations are updated overnight and sometimes a day later. */
  valuation: { calendar: "cn", tz: "Asia/Shanghai", readyHour: 23, lagDays: 2 },
} satisfies Record<string, Availability>;
