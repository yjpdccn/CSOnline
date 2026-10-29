import type { NewsItem, SourceGroup } from "@/lib/types";

const GROUP_BASE: Record<SourceGroup, number> = {
  official: 30,
  "media-zh": 18,
  "media-en": 15,
  blogger: 14,
  community: 10,
};

const RELEASE = /发布|开源|上线|推出|launch|release|introduc|announc|unveil/i;

const logScore = (value: number, scale: number, multiplier: number, cap: number) =>
  Math.min(cap, multiplier * Math.log2(1 + value / scale));

/** Importance used for "热门" sorting and the fallback 今日要点. */
export function computeScore(
  item: Pick<NewsItem, "sourceGroup" | "metrics" | "alsoOn" | "category" | "title">,
): number {
  let score = GROUP_BASE[item.sourceGroup] ?? 10;
  const m = item.metrics ?? {};
  if (m.points) score += logScore(m.points, 50, 6, 20);
  if (m.comments) score += logScore(m.comments, 50, 2, 6);
  if (m.starsToday) score += logScore(m.starsToday, 100, 6, 20);
  else if (m.stars) score += logScore(m.stars, 300, 5, 18);
  if (m.upvotes) score += logScore(m.upvotes, 20, 6, 20);
  if (m.likes) score += logScore(m.likes, 100, 5, 18);
  score += Math.min(3, item.alsoOn?.length ?? 0) * 8;
  if (item.category === "model") score += 6;
  if (RELEASE.test(item.title)) score += 4;
  return Math.round(score * 10) / 10;
}
