import type { RunnerState } from "@/lib/pipeline/runner";
import type { RefreshStatus } from "@/lib/view";

export function toRefreshStatus(state: RunnerState): RefreshStatus {
  const r = state.lastResult;
  return {
    running: state.running,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    progress: state.progress,
    lastError: state.lastError,
    lastResult: r
      ? {
          added: r.totals.added,
          ok: r.ok,
          error: r.error,
          finishedAt: r.finishedAt,
          failedSources: r.sources.filter((s) => !s.ok).length,
        }
      : undefined,
  };
}
