import { CheckCircle2 } from "lucide-react";
import type { StripItem } from "@/lib/invest/page-data";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

const TONE: Record<StripItem["tone"], string> = {
  red: "bg-red-500/12 text-red-700 dark:text-red-300",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  green: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  blue: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
};

/** The few personal items that matter today; everything routine sits further down the page. */
export function AlertStrip({ items, checkedAt }: { items: StripItem[]; checkedAt?: string }) {
  if (!items.length) {
    return (
      <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
        暂无需要特别注意的事项{checkedAt ? ` · 数据检查于 ${formatDateTime(checkedAt)}` : ""}
      </p>
    );
  }
  return (
    <section aria-label="重要提醒" className="rounded-xl border bg-card px-3 py-1">
      <ul className="divide-y">
        {items.map((item) => (
          <li key={item.key} className="flex items-baseline gap-2 py-1.5 text-sm leading-relaxed">
            <span className={cn("shrink-0 rounded px-1.5 text-[11px] leading-5 font-medium", TONE[item.tone])}>{item.label}</span>
            {item.href ? (
              <a
                href={item.href}
                {...(item.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className="min-w-0 underline-offset-2 hover:underline"
              >
                {item.text}
              </a>
            ) : (
              <span className="min-w-0">{item.text}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
