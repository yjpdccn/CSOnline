import { inQuietHours } from "@/lib/invest/notify";
import { formatClock } from "@/lib/time";

/**
 * What a workflow run does. GitHub starts scheduled runs late, sometimes by hours, so each refresh slot has a
 * main cron and backups; the first to start refreshes and the others skip or only send held messages.
 */
export type RunMode = "full" | "notify" | "deploy" | "skip";

export interface RunPlanInput {
  /** github.event_name */
  event: string;
  /** github.event.schedule: the cron line that fired. */
  schedule?: string;
  /** workflow_dispatch input: redeploy without fetching. */
  skipFetch?: boolean;
  now: Date;
  /** Start of the last refresh (data/invest/meta.json). */
  lastRefresh?: string;
  /** The checked-out commit: made by the data bot or not, and when. */
  head?: { bot: boolean; time: string };
  /** notify.json: since when a message has waited for quiet hours to end. */
  held?: string;
}

export interface RunPlan {
  mode: RunMode;
  reason: string;
  scheduledFor?: string;
  delayMinutes?: number;
}

/** Refresh slots start at 07:00 and 19:00 Beijing time (23:00 and 11:00 UTC); each needs one refresh. */
const SLOT_HOURS_UTC = [11, 23];

export function slotStart(now: Date): Date {
  const starts = [-1, 0].flatMap((day) => SLOT_HOURS_UTC.map((h) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + day, h)));
  return new Date(Math.max(...starts.filter((t) => t <= now.getTime())));
}

/** When a "M H * * *" cron line was last due. */
export function cronDue(cron: string | undefined, now: Date): Date | undefined {
  const m = cron?.trim().match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (!m) return undefined;
  const due = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), Number(m[2]), Number(m[1]));
  return new Date(due <= now.getTime() ? due : due - 86_400_000);
}

export function planRun(input: RunPlanInput): RunPlan {
  const { now } = input;
  if (input.event === "workflow_dispatch") return input.skipFetch ? { mode: "deploy", reason: "手动运行：只重新部署页面" } : { mode: "full", reason: "手动运行" };
  if (input.event !== "schedule") return { mode: "full", reason: "代码有更新" };
  const due = cronDue(input.schedule, now);
  const timing = due ? { scheduledFor: due.toISOString(), delayMinutes: Math.round((now.getTime() - due.getTime()) / 60_000) } : {};
  const start = slotStart(now);
  const last = input.lastRefresh ? Date.parse(input.lastRefresh) : NaN;
  if (!(last >= start.getTime())) return { mode: "full", reason: `北京时间 ${formatClock(start.toISOString())} 起的这一轮还没有更新`, ...timing };
  // A code push whose run was replaced in the queue by this one has not gone live yet.
  if (input.head && !input.head.bot && Date.parse(input.head.time) > last) return { mode: "full", reason: "有代码更新还没有上线", ...timing };
  if (input.held && !inQuietHours(now)) return { mode: "notify", reason: "发送夜间免打扰时留下的提醒", ...timing };
  return { mode: "skip", reason: `这一轮已在北京时间 ${formatClock(new Date(last).toISOString())} 更新过`, ...timing };
}
