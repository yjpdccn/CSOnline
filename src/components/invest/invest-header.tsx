"use client";

import { Activity } from "lucide-react";
import { SiteNav } from "@/components/site-nav";
import { INVEST_SITE } from "@/config/invest";
import type { InvestRunSummary } from "@/lib/invest/types";
import { formatDateTime, formatRelative } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useNow } from "../news/hooks";
import { RefreshControl } from "../news/refresh-control";
import { ThemeToggle } from "../news/theme-toggle";
import { InvestStatusDialog } from "./status-dialog";

function Logo() {
  return (
    <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 text-[13px] font-bold text-white shadow-sm">
      投
    </span>
  );
}

export function InvestHeader({ run }: { run: InvestRunSummary | null }) {
  const now = useNow();
  const failed = run?.sources.filter((s) => !s.ok).length ?? 0;
  return (
    <header className="sticky top-0 z-30 h-14 border-b bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-full max-w-6xl items-center gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <a href="#" aria-label={`${INVEST_SITE.name}，回到顶部`}>
            <Logo />
          </a>
          <SiteNav current="invest" />
          <div className="hidden min-w-0 truncate text-xs text-muted-foreground lg:block">{INVEST_SITE.tagline}</div>
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
          <InvestStatusDialog run={run}>
            <button
              type="button"
              className="flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="查看数据来源与更新状态"
            >
              <span className={cn("size-2 shrink-0 rounded-full", !run ? "bg-muted-foreground/40" : failed ? "bg-amber-500" : "bg-emerald-500")} />
              <Activity className="size-3.5 sm:hidden" />
              <span className="hidden truncate sm:inline">
                {run ? `更新于 ${now ? formatRelative(run.finishedAt, now) : formatDateTime(run.finishedAt)}` : "尚未更新"}
              </span>
            </button>
          </InvestStatusDialog>
          <RefreshControl />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
