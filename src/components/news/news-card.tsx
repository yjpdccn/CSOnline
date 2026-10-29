"use client";

import { ArrowBigUp, ChevronDown, ExternalLink, Heart, Layers, MessageSquare, Sparkles, Star, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { CATEGORY_MAP } from "@/config/site";
import { dayKey, formatClock, formatDateTime } from "@/lib/time";
import type { ClientAlsoOn, ClientItem } from "@/lib/view";
import { formatCount } from "./format";
import { Highlight } from "./highlight";

function Metrics({ item }: { item: ClientItem }) {
  const m = item.metrics;
  if (!m) return null;
  const isHn = item.sourceId === "hackernews" || item.alsoOn?.some((a) => a.sourceId === "hackernews");
  return (
    <>
      {m.points ? (
        <span className="inline-flex items-center gap-0.5" title={isHn ? "Hacker News 分数" : "分数"}>
          <ArrowBigUp className="size-3.5" />
          {formatCount(m.points)}
        </span>
      ) : null}
      {m.comments ? (
        <span className="inline-flex items-center gap-1" title="评论数">
          <MessageSquare className="size-3" />
          {formatCount(m.comments)}
        </span>
      ) : null}
      {m.stars ? (
        <span className="inline-flex items-center gap-1" title="GitHub Star">
          <Star className="size-3" />
          {formatCount(m.stars)}
          {m.starsToday ? <span className="text-emerald-600 dark:text-emerald-400">今日 +{formatCount(m.starsToday)}</span> : null}
        </span>
      ) : null}
      {m.upvotes ? (
        <span className="inline-flex items-center gap-1" title="Hugging Face 点赞">
          <ThumbsUp className="size-3" />
          {formatCount(m.upvotes)}
        </span>
      ) : null}
      {m.likes ? (
        <span className="inline-flex items-center gap-1" title="Hugging Face 喜欢">
          <Heart className="size-3" />
          {formatCount(m.likes)}
        </span>
      ) : null}
    </>
  );
}

/** One link per source; a source with several reports links to its first and lists the rest below. */
function firstPerSource(links: ClientAlsoOn[]): ClientAlsoOn[] {
  const seen = new Set<string>();
  return links.filter((a) => (seen.has(a.sourceId) ? false : (seen.add(a.sourceId), true)));
}

function ReportList({ item, terms }: { item: ClientItem; terms: string[] }) {
  const day = dayKey(item.publishedAt);
  return (
    <ul className="relative z-10 mt-2.5 space-y-1.5 border-l-2 pl-3 text-[13px] leading-snug">
      {item.alsoOn?.map((a) => (
        <li key={a.url} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="shrink-0 text-xs font-medium text-foreground/70">{a.name}</span>
          <a
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 flex-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {a.title ? <Highlight text={a.title} terms={terms} /> : "讨论"}
          </a>
          {a.publishedAt && (
            <time dateTime={a.publishedAt} className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {dayKey(a.publishedAt) === day ? formatClock(a.publishedAt) : formatDateTime(a.publishedAt)}
            </time>
          )}
        </li>
      ))}
    </ul>
  );
}

export function NewsCard({ item, terms }: { item: ClientItem; terms: string[] }) {
  const [showReports, setShowReports] = useState<boolean | null>(null);
  const category = CATEGORY_MAP[item.category];
  const untranslated = item.lang === "en" && !item.originalTitle;
  const discussion =
    item.discussionUrl && item.discussionUrl !== item.url && !item.alsoOn?.some((a) => a.url === item.discussionUrl)
      ? item.discussionUrl
      : undefined;
  const alsoOn = item.alsoOn ?? [];
  const sourceLinks = firstPerSource(alsoOn.filter((a) => a.sourceId !== item.sourceId));
  const sourceCount = 1 + sourceLinks.length;
  const hasReports = alsoOn.some((a) => a.title);
  // A search that only matches a merged report's headline opens the list so the hit is visible.
  const reportsMatch = terms.length > 0 && alsoOn.some((a) => terms.some((t) => a.title?.toLowerCase().includes(t)));
  const expanded = showReports ?? reportsMatch;

  return (
    <article
      id={`item-${item.id}`}
      className="group relative rounded-xl border bg-card px-4 py-3.5 transition-colors hover:border-foreground/20 hover:bg-accent/30 focus-within:border-foreground/30"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className={cn("inline-flex h-5 items-center rounded-full px-2 font-medium ring-1 ring-inset", category.badge)}>
          {category.label}
        </span>
        <span className="font-medium text-foreground/80">{item.sourceName}</span>
        {!item.dateOnly && (
          <time dateTime={item.publishedAt} className="tabular-nums">
            {formatClock(item.publishedAt)}
          </time>
        )}
        {sourceCount > 1 && (
          <span className="inline-flex items-center gap-0.5 text-foreground/70" title={`${sourceCount} 个来源报道了这条新闻`}>
            <Layers className="size-3" />
            {sourceCount} 个来源
          </span>
        )}
        {untranslated && <span className="rounded border px-1 text-[10px] leading-4">英文</span>}
        {item.aiSummary && (
          <span className="inline-flex items-center gap-0.5 text-violet-600 dark:text-violet-400" title="中文标题与摘要由 AI 生成">
            <Sparkles className="size-3" />
            AI 摘要
          </span>
        )}
      </div>

      <h3 className="mt-1.5 text-[15px] leading-snug font-semibold text-foreground sm:text-base">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="outline-none after:absolute after:inset-0 after:rounded-xl group-hover:underline group-hover:decoration-foreground/30 group-hover:underline-offset-4"
        >
          <Highlight text={item.title} terms={terms} />
        </a>
      </h3>
      {item.originalTitle && (
        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground" lang="en">
          <Highlight text={item.originalTitle} terms={terms} />
        </p>
      )}
      {item.summary && (
        <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground" lang={item.aiSummary ? "zh-CN" : undefined}>
          <Highlight text={item.summary} terms={terms} />
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <Metrics item={item} />
        {item.topics?.map((t) => (
          <span key={t} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {t}
          </span>
        ))}
        {sourceLinks.length > 0 && (
          <span className="relative z-10 inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
            也见于
            {sourceLinks.map((a, i) => (
              <span key={a.url} className="inline-flex items-center gap-1.5">
                {i > 0 && <span aria-hidden className="text-muted-foreground/50">·</span>}
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={a.title}
                  className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
                >
                  {a.name}
                </a>
              </span>
            ))}
          </span>
        )}
        {hasReports && (
          <button
            type="button"
            onClick={() => setShowReports(!expanded)}
            aria-expanded={expanded}
            className="relative z-10 inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 hover:bg-muted hover:text-foreground"
          >
            {expanded ? "收起" : `${alsoOn.length} 篇报道`}
            <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
          </button>
        )}
        {discussion && (
          <a
            href={discussion}
            target="_blank"
            rel="noopener noreferrer"
            className="relative z-10 inline-flex items-center gap-1 underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
          >
            讨论
            <ExternalLink className="size-3" />
          </a>
        )}
      </div>
      {expanded && hasReports && <ReportList item={item} terms={terms} />}
    </article>
  );
}
