"use client";

import { Activity } from "lucide-react";
import { useState } from "react";
import { SiteNav } from "@/components/site-nav";
import { SITE } from "@/config/site";
import { formatDateTime, formatRelative } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { RefreshStatus, RunInfo } from "@/lib/view";
import { useNow } from "./hooks";
import { RefreshControl } from "./refresh-control";
import { StatusDialog } from "./status-dialog";
import { ThemeToggle } from "./theme-toggle";

function progressPercent(p: RefreshStatus["progress"]): number {
  if (!p) return 5;
  const frac = p.total ? p.done / p.total : 0;
  switch (p.stage) {
    case "starting":
      return 3;
    case "fetching":
      return 5 + 55 * frac;
    case "processing":
      return 62;
    case "summarizing":
      return 65 + 25 * frac;
    case "digest":
      return 92;
    case "saving":
      return 96;
    default:
      return 100;
  }
}

function Logo() {
  return (
    <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 via-indigo-500 to-sky-500 text-[13px] font-bold tracking-tight text-white shadow-sm">
      AI
    </span>
  );
}

export function SiteHeader({ lastRun }: { lastRun: RunInfo | null }) {
  const now = useNow();
  const [progress, setProgress] = useState<RefreshStatus | null>(null);
  const failed = lastRun?.sources.filter((s) => !s.ok).length ?? 0;
  const pct = Math.round(progressPercent(progress?.progress));

  return (
    <header className="sticky top-0 z-30 h-14 border-b bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-full max-w-6xl items-center gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <a href="#" aria-label={`${SITE.name}，回到顶部`}>
            <Logo />
          </a>
          <SiteNav current="ai" />
          <div className="hidden min-w-0 truncate text-xs text-muted-foreground lg:block">{SITE.tagline}</div>
        </div>

        <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
          <StatusDialog run={lastRun}>
            <button
              type="button"
              className="flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="查看数据来源与更新状态"
            >
              <span className="relative flex size-2 shrink-0">
                <span
                  className={cn(
                    "size-2 rounded-full",
                    !lastRun ? "bg-muted-foreground/40" : failed ? "bg-amber-500" : "bg-emerald-500",
                  )}
                />
              </span>
              <Activity className="size-3.5 sm:hidden" />
              <span className="hidden truncate sm:inline">
                {lastRun
                  ? `更新于 ${now ? formatRelative(lastRun.finishedAt, now) : formatDateTime(lastRun.finishedAt)}`
                  : "尚未更新"}
              </span>
            </button>
          </StatusDialog>
          <RefreshControl onProgress={setProgress} />
          <ThemeToggle />
        </div>
      </div>
      {progress?.running && (
        <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-muted" role="progressbar" aria-valuenow={pct}>
          <div className="h-full bg-gradient-to-r from-violet-500 to-sky-500 transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
      )}
    </header>
  );
}
