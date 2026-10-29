import { ArrowBigUp, ExternalLink, Heart, MessageSquare, Sparkles, Star, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { CATEGORY_MAP } from "@/config/site";
import { formatClock } from "@/lib/time";
import type { ClientItem } from "@/lib/view";
import { formatCount } from "./format";
import { Highlight } from "./highlight";

function Metrics({ item }: { item: ClientItem }) {
  const m = item.metrics;
  if (!m) return null;
  const isHn = item.sourceId === "hackernews" || item.alsoOn?.some((a) => a.name === "Hacker News");
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

export function NewsCard({ item, terms }: { item: ClientItem; terms: string[] }) {
  const category = CATEGORY_MAP[item.category];
  const untranslated = item.lang === "en" && !item.originalTitle;
  const discussion =
    item.discussionUrl && item.discussionUrl !== item.url && !item.alsoOn?.some((a) => a.url === item.discussionUrl)
      ? item.discussionUrl
      : undefined;

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
        {item.alsoOn?.length ? (
          <span className="relative z-10 inline-flex flex-wrap items-center gap-1">
            也见于
            {item.alsoOn.map((a, i) => (
              <a
                key={a.url + i}
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
              >
                {a.name}
              </a>
            ))}
          </span>
        ) : null}
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
    </article>
  );
}
