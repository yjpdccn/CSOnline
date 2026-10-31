import { TriangleAlert } from "lucide-react";
import type { PageHealth } from "@/lib/invest/page-data";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

/** Next to a figure the data health check found behind the latest trading day. */
export function StaleTag({ className }: { className?: string }) {
  return (
    <span
      title="没有更新到最新交易日，见页面顶部的数据异常"
      className={cn(
        "inline-flex h-4 shrink-0 items-center rounded bg-amber-500/15 px-1 text-[10px] font-medium text-amber-700 ring-1 ring-amber-500/25 ring-inset dark:text-amber-300",
        className,
      )}
    >
      未更新
    </span>
  );
}

/** Problems that affect the numbers on the page, from the last update's data health check. */
export function DataHealthBanner({ health }: { health: PageHealth | null }) {
  const issues = health?.issues.filter((i) => i.severity === "warn") ?? [];
  if (!health || !issues.length) return null;
  return (
    <section role="alert" aria-labelledby="data-health-title" className="rounded-2xl border border-red-500/30 bg-red-500/[0.05] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 id="data-health-title" className="flex items-center gap-2 text-base font-semibold text-red-700 sm:text-lg dark:text-red-300">
          <TriangleAlert className="size-5" />
          数据异常
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">检查于 {formatDateTime(health.checkedAt)}</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        下面这些数据可能不是最新的或有误，请以基金公司和交易所公布的为准；没有更新到最新交易日的数字旁标有
        <StaleTag className="mx-1 align-[1px]" />。
      </p>
      <ul className="mt-2 space-y-1.5 text-sm leading-relaxed">
        {issues.map((issue) => (
          <li key={issue.key} className="flex gap-2">
            <span className="mt-[0.55rem] size-1.5 shrink-0 rounded-full bg-red-500" />
            <span className="min-w-0">
              {issue.message}
              {issue.firstSeen && <span className="ml-1.5 text-xs whitespace-nowrap text-muted-foreground tabular-nums">{formatDateTime(issue.firstSeen)} 起</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
