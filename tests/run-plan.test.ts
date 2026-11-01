import { describe, expect, it } from "vitest";
import { inQuietHours } from "@/lib/invest/notify";
import { cronDue, planRun, slotStart } from "@/lib/run-plan";

const at = (iso: string) => new Date(iso);
const bot = (time: string) => ({ bot: true, time });

describe("run plan", () => {
  it("knows when a cron line was due and which slot a run belongs to", () => {
    expect(cronDue("13 23 * * *", at("2026-11-01T02:24:42Z"))?.toISOString()).toBe("2026-10-31T23:13:00.000Z");
    expect(cronDue("17 0 * * *", at("2026-11-01T00:20:00Z"))?.toISOString()).toBe("2026-11-01T00:17:00.000Z");
    expect(cronDue("*/5 * * * *", at("2026-11-01T00:20:00Z"))).toBeUndefined();
    expect(slotStart(at("2026-11-01T02:24:42Z")).toISOString()).toBe("2026-10-31T23:00:00.000Z");
    expect(slotStart(at("2026-10-31T16:13:59Z")).toISOString()).toBe("2026-10-31T11:00:00.000Z");
    expect(slotStart(at("2026-11-01T10:59:00Z")).toISOString()).toBe("2026-10-31T23:00:00.000Z");
  });

  it("refreshes once per slot: the first scheduled run refreshes, the backups skip", () => {
    const main = planRun({ event: "schedule", schedule: "13 23 * * *", now: at("2026-10-31T23:14:00Z"), lastRefresh: "2026-10-31T11:15:00Z", head: bot("2026-10-31T11:20:00Z") });
    expect(main).toMatchObject({ mode: "full", scheduledFor: "2026-10-31T23:13:00.000Z", delayMinutes: 1 });
    const backup = planRun({ event: "schedule", schedule: "53 23 * * *", now: at("2026-10-31T23:55:00Z"), lastRefresh: "2026-10-31T23:14:30Z", head: bot("2026-10-31T23:19:00Z") });
    expect(backup).toMatchObject({ mode: "skip", delayMinutes: 2 });
    expect(backup.reason).toBe("这一轮已在北京时间 07:14 更新过");
  });

  it("lets a backup refresh when the main trigger is late or lost", () => {
    const backup = planRun({ event: "schedule", schedule: "17 0 * * *", now: at("2026-11-01T00:18:00Z"), lastRefresh: "2026-10-31T16:14:00Z", head: bot("2026-10-31T16:21:00Z") });
    expect(backup).toMatchObject({ mode: "full", reason: "北京时间 07:00 起的这一轮还没有更新" });
    const late = planRun({ event: "schedule", schedule: "13 11 * * *", now: at("2026-10-31T16:13:59Z"), lastRefresh: "2026-10-31T10:47:56Z" });
    expect(late).toMatchObject({ mode: "full", delayMinutes: 301 });
  });

  it("sends what quiet hours held back from the first run after 08:00, without refreshing again", () => {
    const base = { event: "schedule", lastRefresh: "2026-10-31T23:14:00Z", head: bot("2026-10-31T23:20:00Z"), held: "2026-10-31T23:16:00Z" };
    expect(planRun({ ...base, schedule: "53 23 * * *", now: at("2026-10-31T23:54:00Z") }).mode).toBe("skip");
    expect(planRun({ ...base, schedule: "17 0 * * *", now: at("2026-11-01T00:18:00Z") }).mode).toBe("notify");
  });

  it("deploys a code push whose own run was replaced by a scheduled one in the queue", () => {
    const plan = planRun({ event: "schedule", schedule: "53 11 * * *", now: at("2026-11-01T11:54:00Z"), lastRefresh: "2026-11-01T11:14:00Z", head: { bot: false, time: "2026-11-01T11:30:00Z" } });
    expect(plan).toMatchObject({ mode: "full", reason: "有代码更新还没有上线" });
  });

  it("always refreshes on pushes and manual runs, and only redeploys when asked", () => {
    const now = at("2026-11-01T11:54:00Z");
    expect(planRun({ event: "push", now, lastRefresh: "2026-11-01T11:50:00Z" }).mode).toBe("full");
    expect(planRun({ event: "workflow_dispatch", now }).mode).toBe("full");
    expect(planRun({ event: "workflow_dispatch", skipFetch: true, now }).mode).toBe("deploy");
  });

  it("keeps quiet from 22:00 to 08:00 Beijing time", () => {
    expect(inQuietHours(at("2026-11-01T13:59:00Z"))).toBe(false);
    expect(inQuietHours(at("2026-11-01T14:00:00Z"))).toBe(true);
    expect(inQuietHours(at("2026-10-31T16:15:00Z"))).toBe(true);
    expect(inQuietHours(at("2026-10-31T23:59:00Z"))).toBe(true);
    expect(inQuietHours(at("2026-11-01T00:00:00Z"))).toBe(false);
  });
});
