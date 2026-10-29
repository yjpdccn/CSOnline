"use client";

import { ChevronDown, ChevronUp, Loader2, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDay, relativeDayLabel } from "@/lib/time";
import type { ClientItem } from "@/lib/view";
import { useNow } from "./hooks";
import { NewsCard } from "./news-card";
import { RepoList } from "./repo-list";

export interface DayGroup {
  day: string;
  /** Cards, already in display order. */
  news: ClientItem[];
  /** Repo listings, shown as one compact block. */
  repos: ClientItem[];
  /** Items of this group before filtering. */
  total: number;
}

function countLabel(shown: number, total: number): string {
  return shown === total ? `${total} 条` : `${shown} / ${total} 条`;
}

function FeedSection({
  id,
  heading,
  count,
  news,
  repos,
  terms,
  footer,
}: {
  id: string;
  heading: ReactNode;
  count: string;
  news: ClientItem[];
  repos: ClientItem[];
  terms: string[];
  footer?: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="scroll-mt-32">
      <div className="mb-3 flex items-baseline gap-2 px-1">
        <h2 id={id} className="text-sm font-semibold">
          {heading}
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
        <div className="h-px flex-1 self-center bg-border" />
      </div>
      <div className="space-y-2.5">
        {news.map((item) => (
          <NewsCard key={item.id} item={item} terms={terms} />
        ))}
        {repos.length > 0 && <RepoList items={repos} terms={terms} />}
        {footer}
      </div>
    </section>
  );
}

export function DaySection({ group, terms, label }: { group: DayGroup; terms: string[]; label?: string }) {
  const now = useNow();
  const relative = now ? relativeDayLabel(group.day, now) : null;
  return (
    <FeedSection
      id={`day-${group.day}`}
      heading={
        <>
          {relative && <span className="mr-1.5 text-foreground">{relative}</span>}
          <span className={relative ? "text-muted-foreground" : ""}>{formatDay(group.day)}</span>
          {label && <span className="ml-1.5 font-normal text-muted-foreground">{label}</span>}
        </>
      }
      count={countLabel(group.news.length + group.repos.length, group.total)}
      news={group.news}
      repos={group.repos}
      terms={terms}
    />
  );
}

export interface PeriodGroup {
  hours: number;
  news: ClientItem[];
  repos: ClientItem[];
  total: number;
}

/**
 * Default view: the top stories of the latest period by importance. The rest of the period, its repo
 * listings and earlier days fold under 更多.
 */
export function ImportanceFeed({
  period,
  older,
  terms,
  limit,
  expanded,
  collapsible,
  onExpandedChange,
  after,
}: {
  period: PeriodGroup;
  older: DayGroup[];
  terms: string[];
  limit: number;
  expanded: boolean;
  /** False while searching: every match is shown. */
  collapsible: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** Rendered after the earlier days once expanded (the load-more control). */
  after?: ReactNode;
}) {
  const shown = expanded ? period.news : period.news.slice(0, limit);
  const folded = period.news.length - shown.length + (expanded ? 0 : period.repos.length);
  const earlier = older.reduce((n, g) => n + g.news.length + g.repos.length, 0);
  const hidden = folded + (expanded ? 0 : earlier);
  const periodCount = period.news.length + period.repos.length;

  const toggle = (
    <button
      type="button"
      onClick={() => onExpandedChange(!expanded)}
      aria-expanded={expanded}
      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed bg-card/60 px-4 py-3 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
    >
      {expanded ? (
        <>
          收起，只看前 {Math.min(limit, period.news.length)} 条
          <ChevronUp className="size-4" />
        </>
      ) : (
        <>
          更多（还有 {hidden} 条{earlier > 0 ? "，含更早的日期" : ""}）
          <ChevronDown className="size-4" />
        </>
      )}
    </button>
  );

  return (
    <div className="space-y-7">
      {periodCount > 0 && (
        <FeedSection
          id="period-latest"
          heading={
            <>
              过去 {period.hours} 小时
              <span className="ml-1.5 font-normal text-muted-foreground">按重要性排序</span>
            </>
          }
          count={countLabel(periodCount, period.total)}
          news={shown}
          repos={expanded ? period.repos : []}
          terms={terms}
          footer={collapsible && (hidden > 0 || (expanded && period.news.length > limit)) ? toggle : undefined}
        />
      )}
      {(expanded || periodCount === 0) && (
        <>
          {older.map((group) => (
            <DaySection key={group.day} group={group} terms={terms} label={group.day === older[0]?.day && periodCount ? "更早" : undefined} />
          ))}
          {after}
        </>
      )}
    </div>
  );
}

export function FeedSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2.5" aria-busy="true" aria-label="加载中">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="rounded-xl border bg-card px-4 py-3.5">
          <div className="flex gap-2">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-20" />
          </div>
          <Skeleton className="mt-2.5 h-5 w-4/5" />
          <Skeleton className="mt-2 h-4 w-full" />
          <Skeleton className="mt-1.5 h-4 w-2/3" />
        </div>
      ))}
    </div>
  );
}

export function LoadMore({
  next,
  loading,
  error,
  onLoad,
}: {
  next: { day: string; count: number } | undefined;
  loading: boolean;
  error: string | null;
  onLoad: () => void;
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          正在加载 {next ? formatDay(next.day) : ""}
        </p>
        <FeedSkeleton rows={2} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-4 text-center text-sm">
        <p className="text-destructive">加载失败：{error}</p>
        <Button variant="outline" size="sm" onClick={onLoad}>
          <RotateCcw />
          重试
        </Button>
      </div>
    );
  }
  if (!next) {
    return <p className="py-2 text-center text-xs text-muted-foreground">已经到底了，更早的内容会随每次更新逐步积累</p>;
  }
  return (
    <div className="flex justify-center">
      <Button variant="outline" size="lg" onClick={onLoad}>
        <ChevronDown />
        加载更早一天（{formatDay(next.day)} · {next.count} 条）
      </Button>
    </div>
  );
}
