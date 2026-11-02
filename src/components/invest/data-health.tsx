import { cn } from "@/lib/utils";

/** Next to a figure the data health check found behind the latest trading day. */
export function StaleTag({ className }: { className?: string }) {
  return (
    <span
      title="没有更新到最新交易日，见页面顶部的提醒"
      className={cn(
        "inline-flex h-4 shrink-0 items-center rounded bg-amber-500/15 px-1 text-[10px] font-medium text-amber-700 ring-1 ring-amber-500/25 ring-inset dark:text-amber-300",
        className,
      )}
    >
      未更新
    </span>
  );
}
