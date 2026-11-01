/**
 * First step of the workflow: decides whether this run refreshes, only sends held messages, only redeploys,
 * or skips, and writes `mode` and `scheduled_for` to $GITHUB_OUTPUT.
 */
import { execSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { formatDateTime } from "@/lib/time";
import { planRun } from "@/lib/run-plan";

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function headCommit(): { bot: boolean; time: string } | undefined {
  try {
    const [email, time] = execSync("git log -1 --format=%ae%n%cI").toString().trim().split("\n");
    return { bot: email.includes("github-actions[bot]"), time };
  } catch {
    return undefined;
  }
}

const meta = readJson<{ lastRun?: { startedAt?: string } }>("data/invest/meta.json");
const notify = readJson<{ held?: string }>("data/invest/notify.json");
const plan = planRun({
  event: process.env.EVENT ?? "push",
  schedule: process.env.SCHEDULE || undefined,
  skipFetch: process.env.SKIP_FETCH === "true",
  now: new Date(),
  lastRefresh: meta?.lastRun?.startedAt,
  head: headCommit(),
  held: notify?.held,
});

if (plan.scheduledFor) console.log(`定时任务计划在 ${formatDateTime(plan.scheduledFor)}（北京时间）开始，实际晚了 ${plan.delayMinutes} 分钟`);
console.log(`本次：${{ full: "完整更新", notify: "只发送提醒", deploy: "只重新部署", skip: "跳过" }[plan.mode]}（${plan.reason}）`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `mode=${plan.mode}\nscheduled_for=${plan.scheduledFor ?? ""}\n`);
