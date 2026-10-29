export function formatCount(n: number): string {
  if (n >= 10_000) return `${(n / 10_000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, "")}万`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
}

export const TRIGGER_LABELS: Record<string, string> = {
  schedule: "定时任务",
  manual: "手动刷新",
  cli: "命令行",
  workflow_dispatch: "手动运行（GitHub Actions）",
  push: "代码推送（GitHub Actions）",
};

export function searchTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}
