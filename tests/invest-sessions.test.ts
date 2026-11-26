import { describe, expect, it } from "vitest";
import { detectEvents, eventObservations, type EventsFile } from "@/lib/invest/events";
import { diffNotifications } from "@/lib/invest/notify";
import { orderDay, settledUsCloses, usCloseAt, usHolidayOrder } from "@/lib/invest/sessions";
import type { Close, MarketFile } from "@/lib/invest/types";

const market = (closes: Close[]): MarketFile => ({ updatedAt: "", valuations: {}, series: { ndx: { name: "纳斯达克100", closes, source: "test", fetchedAt: "" } } });
const empty: EventsFile = { updatedAt: "", bands: {}, events: [] };

describe("US closes", () => {
  it("finds the China order day and whether US markets are closed on it", () => {
    // 04:27 in Beijing: before the 15:00 cut-off, so the 26th, US Thanksgiving.
    expect(orderDay("2026-11-25T20:27:00Z")).toBe("2026-11-26");
    expect(usHolidayOrder("2026-11-25T20:27:00Z")).toBe("2026-11-26");
    // 16:58 in Beijing on the 26th: past the cut-off, orders are for the 27th, a US trading day.
    expect(orderDay("2026-11-26T08:58:00Z")).toBe("2026-11-27");
    expect(usHolidayOrder("2026-11-26T08:58:00Z")).toBeUndefined();
    // Friday evening in Beijing: the next order day is Monday.
    expect(orderDay("2026-11-27T10:00:00Z")).toBe("2026-11-30");
  });

  it("knows when a New York session ends, across DST and early closes", () => {
    expect(usCloseAt("2026-11-20").toISOString()).toBe("2026-11-20T21:00:00.000Z");
    expect(usCloseAt("2026-07-15").toISOString()).toBe("2026-07-15T20:00:00.000Z");
    expect(usCloseAt("2026-11-27").toISOString()).toBe("2026-11-27T18:00:00.000Z");
    expect(usCloseAt("2026-12-24").toISOString()).toBe("2026-12-24T18:00:00.000Z");
  });

  it("drops a mid-session snapshot and keeps the day once the close has settled", () => {
    // The 11-20 evening run started at 19:05 UTC, 14:05 in New York, with the Nasdaq 100 down 3.8% so far.
    const snapshot: Close[] = [
      ["2026-11-18", 27116.26],
      ["2026-11-19", 26517.05],
      ["2026-11-20", 25505.78],
    ];
    expect(settledUsCloses(snapshot, "2026-11-20T19:05:00Z").map(([day]) => day)).toEqual(["2026-11-18", "2026-11-19"]);
    expect(detectEvents({ market: market(settledUsCloses(snapshot, "2026-11-20T19:05:00Z")), ranked: [], previous: empty, now: new Date("2026-11-20T19:05:00Z") }).events).toEqual([]);
    // Vendors may still be posting the closing value in the hour after the bell.
    expect(settledUsCloses(snapshot, "2026-11-20T21:30:00Z")).toHaveLength(2);
    expect(settledUsCloses(snapshot, "2026-11-21T03:58:00Z")).toHaveLength(3);

    const early: Close[] = [["2026-11-27", 100]];
    expect(settledUsCloses(early, "2026-11-27T17:30:00Z")).toEqual([]);
    expect(settledUsCloses(early, "2026-11-27T19:05:00Z")).toEqual(early);
    const summer: Close[] = [["2026-07-15", 100]];
    expect(settledUsCloses(summer, "2026-07-15T20:30:00Z")).toEqual([]);
    expect(settledUsCloses(summer, "2026-07-15T21:05:00Z")).toEqual(summer);
  });

  it("gives a listed move the figures of the real close without pushing it again", () => {
    const recorded = detectEvents({ market: market([["2026-11-19", 26517.05], ["2026-11-20", 25505.78]]), ranked: [], previous: empty, now: new Date("2026-11-20T19:05:00Z") });
    expect(recorded.events.map((e) => [e.title, e.detail])).toEqual([["纳斯达克100 11月20日下跌 3.8%", "单日变动超过 3%，收于 25,505.78。"]]);

    const now = new Date("2026-11-21T03:58:00Z");
    const settled = detectEvents({ market: market([["2026-11-19", 26517.05], ["2026-11-20", 25028.98]]), ranked: [], previous: recorded, now });
    expect(settled.events).toEqual([{ ...recorded.events[0], title: "纳斯达克100 11月20日下跌 5.6%", detail: "单日变动超过 3%，收于 25,028.98。" }]);
    const sent = { "alert:move:ndx:2026-11-20": { hash: "move:ndx:2026-11-20", label: "纳斯达克100 11月20日下跌 3.8%", kind: "event" as const } };
    expect(diffNotifications(sent, [], eventObservations(settled, now), now).events).toEqual([]);

    const smaller = detectEvents({ market: market([["2026-11-19", 26517.05], ["2026-11-20", 25900]]), ranked: [], previous: recorded, now });
    expect(smaller.events).toEqual([]);
  });
});
