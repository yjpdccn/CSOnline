"use client";

import { ChevronDown, Flame, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { TOPIC_FILTERS } from "@/config/invest-news";
import type { InvestNewsCard } from "@/lib/invest/page-data";
import { dayKey, formatClock, formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

const TOPIC_LABEL = new Map(TOPIC_FILTERS.flatMap((f) => f.topics.map((t) => [t, f.label] as const)));
const PAGE = 15;

function NewsRow({ card, today }: { card: InvestNewsCard; today: string }) {
  const labels = [...new Set(card.topics.map((t) => TOPIC_LABEL.get(t)).filter(Boolean))].slice(0, 3);
  const time = card.dateOnly ? formatDateTime(card.publishedAt).split(" ")[0] : dayKey(card.publishedAt) === today ? formatClock(card.publishedAt) : formatDateTime(card.publishedAt);
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground/80">{card.sourceName}</span>
        <time dateTime={card.publishedAt} className="tabular-nums">
          {time}
        </time>
        {card.important && (
          <span className="inline-flex items-center gap-0.5 text-red-600 dark:text-red-400" title="来源标记为重要">
            <Flame className="size-3" />
            重要
          </span>
        )}
        {labels.map((l) => (
          <span key={l} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px]">
            {l}
          </span>
        ))}
        {card.aiSummary && (
          <span className="inline-flex items-center gap-0.5 text-violet-600 dark:text-violet-400" title="中文标题与摘要由 AI 生成">
            <Sparkles className="size-3" />
            AI 译
          </span>
        )}
      </div>
      <h3 className="mt-1 text-[15px] leading-snug font-semibold">
        <a href={card.url} target="_blank" rel="noopener noreferrer" className="hover:underline hover:decoration-foreground/30 hover:underline-offset-4">
          {card.title}
        </a>
      </h3>
      {card.originalTitle && (
        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground" lang="en">
          {card.originalTitle}
        </p>
      )}
      {card.summary && <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{card.summary}</p>}
      {card.alsoOn && (
        <p className="mt-1.5 flex flex-wrap gap-x-1.5 text-xs text-muted-foreground">
          也见于
          {card.alsoOn.map((a, i) => (
            <span key={a.url}>
              {i > 0 && <span className="mr-1.5 text-muted-foreground/50">·</span>}
              <a href={a.url} target="_blank" rel="noopener noreferrer" title={a.title} className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground">
                {a.name}
              </a>
            </span>
          ))}
        </p>
      )}
    </li>
  );
}

export function NewsList({ news, asOf }: { news: InvestNewsCard[]; asOf: string }) {
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState(false);
  const today = dayKey(asOf);
  const filtered = useMemo(() => {
    const topics = TOPIC_FILTERS.find((f) => f.id === filter)?.topics;
    return topics ? news.filter((n) => n.topics.some((t) => topics.includes(t))) : news;
  }, [news, filter]);
  const counts = useMemo(
    () => new Map(TOPIC_FILTERS.map((f) => [f.id, news.filter((n) => n.topics.some((t) => f.topics.includes(t))).length])),
    [news],
  );
  const shown = expanded ? filtered : filtered.slice(0, PAGE);
  const tabs = [{ id: "all", label: "全部", count: news.length }, ...TOPIC_FILTERS.map((f) => ({ id: f.id, label: f.label, count: counts.get(f.id) ?? 0 }))];

  return (
    <section aria-labelledby="news-title" className="rounded-2xl border bg-card">
      <div className="border-b px-4 pt-3 pb-2.5">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 id="news-title" className="text-base font-semibold">
            要闻
          </h2>
          <span className="text-xs text-muted-foreground">最近 3 天，按重要性排序；同一事件的多家报道合并为一条</span>
        </div>
        <div className="scrollbar-none -mx-1 mt-2 flex gap-1 overflow-x-auto px-1" role="tablist" aria-label="按话题筛选">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={filter === tab.id}
              onClick={() => {
                setFilter(tab.id);
                setExpanded(false);
              }}
              className={cn(
                "shrink-0 rounded-full border px-2.5 py-1 text-xs transition-colors",
                filter === tab.id ? "border-foreground/20 bg-foreground text-background" : "bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              <span className="ml-1 tabular-nums opacity-70">{tab.count}</span>
            </button>
          ))}
        </div>
      </div>
      {shown.length ? (
        <ul className="divide-y">
          {shown.map((card) => (
            <NewsRow key={card.id} card={card} today={today} />
          ))}
        </ul>
      ) : (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">这个话题最近 3 天没有要闻。</p>
      )}
      {filtered.length > PAGE && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-center gap-1 border-t px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground"
        >
          {expanded ? "收起" : `显示全部 ${filtered.length} 条`}
          <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} />
        </button>
      )}
    </section>
  );
}
