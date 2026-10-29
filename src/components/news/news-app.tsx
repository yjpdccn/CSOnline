"use client";

import { CloudOff, Inbox, Newspaper, SearchX, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SITE } from "@/config/site";
import { dayDataUrl, IS_STATIC, WORKFLOW_URL } from "@/lib/env";
import type { CategoryId } from "@/lib/types";
import type { ClientDay, ClientItem, HomeData } from "@/lib/view";
import { DigestCard } from "./digest-card";
import { EmptyState } from "./empty-state";
import { FilterBar } from "./filter-bar";
import { searchTerms } from "./format";
import { DEFAULT_FILTERS, useNewsFilters } from "./hooks";
import { DaySection, LoadMore, type DayGroup } from "./news-feed";
import { RefreshControl } from "./refresh-control";
import { Sidebar } from "./sidebar";
import { SiteHeader } from "./site-header";

function haystack(item: ClientItem): string {
  return [
    item.title,
    item.originalTitle,
    item.summary,
    item.sourceName,
    ...(item.topics ?? []),
    ...(item.alsoOn ?? []).flatMap((a) => [a.name, a.title]),
  ]
    .filter(Boolean)
    .join(" \n ")
    .toLowerCase();
}

/** A merged card belongs to every source that reported the story. */
function cardSources(item: ClientItem): string[] {
  return [...new Set([item.sourceId, ...(item.alsoOn ?? []).map((a) => a.sourceId)])];
}

export function NewsApp({ data, error }: { data: HomeData | null; error: string | null }) {
  const [filters, setFilters] = useNewsFilters();
  const [extraDays, setExtraDays] = useState<ClientDay[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const days = useMemo(() => {
    const initial = data?.days ?? [];
    const seen = new Set(initial.map((d) => d.day));
    return [...initial, ...extraDays.filter((d) => !seen.has(d.day))].sort((a, b) => b.day.localeCompare(a.day));
  }, [data, extraDays]);

  const indexed = useMemo(
    () =>
      days.map((d) => ({
        day: d.day,
        items: d.items.map((item) => ({ item, text: haystack(item), sources: cardSources(item) })),
      })),
    [days],
  );

  const terms = useMemo(() => searchTerms(filters.query), [filters.query]);

  const { groups, categoryCounts, sourceCounts, totalShown } = useMemo(() => {
    const categoryCounts = new Map<CategoryId | "all", number>();
    const sourceCounts = new Map<string, number>();
    const sourceSet = new Set(filters.sources);
    const groups: DayGroup[] = [];
    let totalShown = 0;
    for (const day of indexed) {
      const shown: ClientItem[] = [];
      for (const { item, text, sources } of day.items) {
        const matchesQuery = terms.every((t) => text.includes(t));
        if (!matchesQuery) continue;
        const matchesSource = sourceSet.size === 0 || sources.some((s) => sourceSet.has(s));
        const matchesCategory = filters.category === "all" || item.category === filters.category;
        if (matchesSource) {
          categoryCounts.set("all", (categoryCounts.get("all") ?? 0) + 1);
          categoryCounts.set(item.category, (categoryCounts.get(item.category) ?? 0) + 1);
        }
        if (matchesCategory) for (const s of sources) sourceCounts.set(s, (sourceCounts.get(s) ?? 0) + 1);
        if (matchesSource && matchesCategory) shown.push(item);
      }
      shown.sort((a, b) =>
        filters.sort === "hot" ? b.score - a.score : b.publishedAt.localeCompare(a.publishedAt),
      );
      totalShown += shown.length;
      if (shown.length) groups.push({ day: day.day, items: shown, total: day.items.length });
    }
    return { groups, categoryCounts, sourceCounts, totalShown };
  }, [indexed, terms, filters.category, filters.sources, filters.sort]);

  const loadedDays = new Set(days.map((d) => d.day));
  const oldest = days.at(-1)?.day;
  const nextDay = data?.dayIndex.find((d) => !loadedDays.has(d.day) && (!oldest || d.day < oldest));

  async function loadMore() {
    if (!nextDay) return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const res = await fetch(dayDataUrl(nextDay.day), { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 404 ? "这一天的数据不存在" : `HTTP ${res.status}`);
      const day: ClientDay = await res.json();
      setExtraDays((prev) => [...prev, day]);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "网络错误");
    } finally {
      setLoadingMore(false);
    }
  }

  const filtered = filters.category !== "all" || filters.sources.length > 0 || terms.length > 0;
  const hasData = days.some((d) => d.items.length > 0);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader lastRun={data?.lastRun ?? null} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-16 sm:px-6 sm:pt-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17.5rem] lg:gap-8">
          <div className="min-w-0 space-y-5">
            {error && (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>数据读取失败</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {data?.lastRun && !data.lastRun.ok && (
              <Alert variant="destructive">
                <CloudOff />
                <AlertTitle>上次更新没有成功</AlertTitle>
                <AlertDescription>{data.lastRun.error ?? "所有来源都抓取失败"}，下面显示的是之前保存的内容。</AlertDescription>
              </Alert>
            )}

            {data?.digest && <DigestCard digest={data.digest} llm={data.lastRun?.llm} />}

            {hasData ? (
              <>
                <FilterBar
                  filters={filters}
                  onChange={setFilters}
                  categoryCounts={categoryCounts}
                  sourceCounts={sourceCounts}
                  sources={data?.sources ?? []}
                />
                {filtered && (
                  <p className="-mt-2 px-1 text-xs text-muted-foreground" aria-live="polite">
                    在已加载的 {days.length} 天中找到 {totalShown} 条
                    {nextDay ? "，更早的日期可在页面底部继续加载" : ""}
                  </p>
                )}
                {groups.length > 0 ? (
                  <div className="space-y-7">
                    {groups.map((group) => (
                      <DaySection
                        key={group.day}
                        group={group}
                        terms={terms}
                        compactRepos={filters.category !== "opensource"}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    icon={SearchX}
                    title="没有符合条件的资讯"
                    description={terms.length ? `没有找到包含「${filters.query.trim()}」的内容，试试换个关键词或加载更早的日期。` : "换个分类或来源试试。"}
                    action={
                      <Button variant="outline" onClick={() => setFilters(DEFAULT_FILTERS)}>
                        清除全部筛选
                      </Button>
                    }
                  />
                )}
                <LoadMore next={nextDay} loading={loadingMore} error={loadError} onLoad={loadMore} />
              </>
            ) : (
              !error && (
                <EmptyState
                  icon={IS_STATIC ? Inbox : Newspaper}
                  title="还没有资讯"
                  description={
                    IS_STATIC
                      ? `${SITE.scheduleLabel}。首次自动更新完成后，这里会按天显示 AI 行业动态。`
                      : "点击下方按钮抓取最新资讯，大约需要 10 秒到 1 分钟（开启 AI 摘要时更久）。之后开发服务器会每 12 小时自动更新一次。"
                  }
                  action={
                    IS_STATIC ? (
                      WORKFLOW_URL ? (
                        <Button asChild variant="outline">
                          <a href={WORKFLOW_URL} target="_blank" rel="noopener noreferrer">
                            在 GitHub Actions 中手动运行
                          </a>
                        </Button>
                      ) : null
                    ) : (
                      <RefreshControl />
                    )
                  }
                />
              )
            )}
          </div>

          <aside className="hidden lg:block">
            <Sidebar
              category={filters.category}
              counts={categoryCounts}
              onCategory={(category) => setFilters({ ...filters, category })}
              lastRun={data?.lastRun ?? null}
              loadedDays={days.length}
            />
          </aside>
        </div>
      </main>
      <footer className="border-t py-6">
        <div className="mx-auto max-w-6xl px-4 text-center text-xs leading-relaxed text-muted-foreground sm:px-6">
          {SITE.name} · 自动聚合官方博客、Hugging Face、Hacker News、GitHub、Reddit 与中英文科技媒体的 AI 资讯 · 时间均为北京时间
        </div>
      </footer>
    </div>
  );
}
