import { CATEGORIES, CATEGORY_MAP } from "@/config/site";
import { periodStart, rankStories, REPO_SOURCES } from "@/lib/rank";
import { storyFirstAt, storyWeight } from "./importance";
import { translatedTitle } from "./text";
import type { DigestPoint, NewsItem } from "@/lib/types";

export function displayTitle(item: NewsItem): string {
  return translatedTitle(item) ?? item.title;
}

export interface LatestPeriod {
  hours: number;
  /** Every card published in the period. */
  period: NewsItem[];
  /** The period's non-repo cards in the page's importance order. */
  ranked: NewsItem[];
}

export function rankLatestPeriod(cards: NewsItem[], now: Date): LatestPeriod {
  const start = periodStart(cards, now.getTime());
  const period = cards.filter((i) => Date.parse(i.publishedAt) >= start);
  const rankable = period
    .filter((i) => !REPO_SOURCES.has(i.sourceId))
    .map((item) => ({ item, sourceId: item.sourceId, weight: storyWeight(item), publishedAt: item.publishedAt, firstAt: storyFirstAt(item) }));
  const hours = Math.round((now.getTime() - start) / 3_600_000);
  return { hours, period, ranked: rankStories(rankable, now.getTime()).map((r) => r.item) };
}

/** Automatic 今日要点: the top of the importance ranking the page shows. */
export function buildFallbackDigest({ hours, period, ranked }: LatestPeriod, max = 5): { overview: string; points: DigestPoint[] } {
  const counts = CATEGORIES.map((c) => ({ label: c.label, n: period.filter((i) => i.category === c.id).length }))
    .filter((c) => c.n > 0)
    .sort((a, b) => b.n - a.n);
  const breakdown = counts.map((c) => `${c.label} ${c.n} 条`).join("、");
  const overview = period.length
    ? `过去 ${hours} 小时共收录 ${period.length} 条 AI 资讯${breakdown ? `：${breakdown}` : ""}。以下为按重要性排序的前 ${Math.min(max, ranked.length)} 条。`
    : `过去 ${hours} 小时暂无新的 AI 资讯。`;
  const points = ranked.slice(0, max).map((item) => ({
    text: `【${CATEGORY_MAP[item.category].short}】${displayTitle(item)}`,
    refs: [item.id],
  }));
  return { overview, points };
}
