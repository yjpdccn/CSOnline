import { SITE } from "@/config/site";
import { runRefresh } from "./refresh";
import { readMeta } from "./store";
import type { RefreshProgress, RunSummary } from "@/lib/types";

export interface RunnerState {
  running: boolean;
  trigger?: string;
  startedAt?: string;
  finishedAt?: string;
  progress?: RefreshProgress;
  lastResult?: RunSummary;
  lastError?: string;
}

const STATE_KEY = Symbol.for("ai-news-digest.runner");
const SCHEDULER_KEY = Symbol.for("ai-news-digest.scheduler");

type GlobalWithState = typeof globalThis & {
  [STATE_KEY]?: RunnerState;
  [SCHEDULER_KEY]?: boolean;
};

function state(): RunnerState {
  const g = globalThis as GlobalWithState;
  g[STATE_KEY] ??= { running: false };
  return g[STATE_KEY];
}

export function getRunnerState(): RunnerState {
  return { ...state() };
}

/** Starts a refresh in the background of the server process. */
export function startRefresh(trigger: string): { started: boolean; state: RunnerState } {
  const s = state();
  if (s.running) return { started: false, state: { ...s } };
  s.running = true;
  s.trigger = trigger;
  s.startedAt = new Date().toISOString();
  s.finishedAt = undefined;
  s.lastError = undefined;
  s.progress = { stage: "starting", done: 0, total: 1, message: "准备中" };
  runRefresh({ trigger, onProgress: (p) => (s.progress = p) })
    .then((result) => {
      s.lastResult = result;
    })
    .catch((err: Error) => {
      s.lastError = err.message;
      console.error("[refresh] failed:", err);
    })
    .finally(() => {
      s.running = false;
      s.finishedAt = new Date().toISOString();
    });
  return { started: true, state: { ...s } };
}

function intervalHours(): number {
  const v = Number(process.env.REFRESH_INTERVAL_HOURS);
  return Number.isFinite(v) && v > 0 ? v : SITE.refreshIntervalHours;
}

/** Local server mode: refresh when the last successful run is older than the interval. */
export function startScheduler() {
  const g = globalThis as GlobalWithState;
  if (g[SCHEDULER_KEY]) return;
  g[SCHEDULER_KEY] = true;
  const intervalMs = intervalHours() * 3_600_000;

  const tick = async () => {
    try {
      const meta = await readMeta();
      const last = meta.lastRun?.finishedAt ? Date.parse(meta.lastRun.finishedAt) : 0;
      if (Date.now() - last >= intervalMs) {
        const { started } = startRefresh("schedule");
        if (started) console.log(`[scheduler] 距上次更新已超过 ${intervalHours()} 小时，开始自动更新`);
      }
    } catch (err) {
      console.error("[scheduler] check failed:", err);
    }
  };

  console.log(`[scheduler] 已启动：每 ${intervalHours()} 小时自动更新一次`);
  setTimeout(tick, 15_000).unref?.();
  setInterval(tick, 10 * 60_000).unref?.();
}
