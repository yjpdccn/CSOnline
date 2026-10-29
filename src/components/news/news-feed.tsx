"use client";

import { ChevronDown, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDay, relativeDayLabel } from "@/lib/time";
import type { ClientItem } from "@/lib/view";
import { useNow } from "./hooks";
import { NewsCard } from "./news-card";
import { REPO_SOURCES, RepoList } from "./repo-list";

export interface DayGroup {
  day: string;
  items: ClientItem[];
  total: number;
}

export function DaySection({ group, terms, compactRepos }: { group: DayGroup; terms: string[]; compactRepos: boolean }) {
  const now = useNow();
  const relative = now ? relativeDayLabel(group.day, now) : null;
  const repos = compactRepos ? group.items.filter((i) => REPO_SOURCES.has(i.sourceId)) : [];
  const news = repos.length ? group.items.filter((i) => !REPO_SOURCES.has(i.sourceId)) : group.items;
  return (
    <section aria-labelledby={`day-${group.day}`} className="scroll-mt-32">
      <div className="mb-3 flex items-baseline gap-2 px-1">
        <h2 id={`day-${group.day}`} className="text-sm font-semibold">
          {relative && <span className="mr-1.5 text-foreground">{relative}</span>}
          <span className={relative ? "text-muted-foreground" : ""}>{formatDay(group.day)}</span>
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {group.items.length === group.total ? `${group.total} 条` : `${group.items.length} / ${group.total} 条`}
        </span>
        <div className="h-px flex-1 self-center bg-border" />
      </div>
      <div className="space-y-2.5">
        {news.map((item) => (
          <NewsCard key={item.id} item={item} terms={terms} />
        ))}
        {repos.length > 0 && <RepoList items={repos} terms={terms} />}
      </div>
    </section>
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
