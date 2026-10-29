import { categorize, checkAiRelevance, matchTopics } from "./keywords";
import { computeScore } from "./score";
import { collapse, detectLang } from "./text";
import { hashKey, keyFromUrl } from "./url";
import { dayKey } from "@/lib/time";
import type { Metrics, NewsItem, RawItem, SourceConfig } from "@/lib/types";

export function isRelevant(raw: RawItem, source: SourceConfig): boolean {
  if (source.aiFocused) return true;
  if (raw.relevanceText) return checkAiRelevance(raw.relevanceText).relevant;
  return checkAiRelevance(raw.title, raw.excerpt).relevant;
}

function cleanMetrics(m: Metrics | undefined): Metrics | undefined {
  if (!m) return undefined;
  const entries = Object.entries(m).filter(([, v]) => typeof v === "number" && Number.isFinite(v) && v > 0);
  return entries.length ? (Object.fromEntries(entries) as Metrics) : undefined;
}

export function parsePublished(raw: RawItem, now: Date): Date {
  const parsed = raw.publishedAt ? new Date(raw.publishedAt) : now;
  if (Number.isNaN(parsed.getTime())) return now;
  if (parsed.getTime() > now.getTime() + 10 * 60_000) return now;
  return parsed;
}

export function toNewsItem(raw: RawItem, source: SourceConfig, now: Date): NewsItem | null {
  const title = collapse(raw.title ?? "");
  if (!title || !raw.url) return null;
  const key = raw.key ?? keyFromUrl(raw.externalUrl ?? raw.url);
  const published = parsePublished(raw, now);
  const forced = raw.category ?? source.category;
  const item: NewsItem = {
    id: hashKey(key),
    key,
    title,
    url: raw.url,
    excerpt: raw.excerpt,
    lang: raw.lang ?? source.lang ?? detectLang(title),
    sourceId: source.id,
    sourceName: source.name,
    sourceGroup: source.group,
    publishedAt: published.toISOString(),
    dateOnly: raw.dateOnly || undefined,
    firstSeenAt: now.toISOString(),
    day: dayKey(published),
    category: forced ?? categorize(title, raw.excerpt, source.defaultCategory),
    categoryLocked: forced ? true : undefined,
    keywords: matchTopics(`${title} ${raw.excerpt ?? ""}`),
    score: 0,
    metrics: cleanMetrics(raw.metrics),
    discussionUrl: raw.discussionUrl,
    skipLlm: raw.skipLlm || undefined,
  };
  if (!item.keywords?.length) delete item.keywords;
  item.score = computeScore(item);
  return item;
}
