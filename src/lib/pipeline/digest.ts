import { CATEGORIES, CATEGORY_MAP } from "@/config/site";
import { titleFingerprint, translatedTitle } from "./text";
import type { DigestPoint, NewsItem } from "@/lib/types";

export function displayTitle(item: NewsItem): string {
  return translatedTitle(item) ?? item.title;
}

function longestCommonSubstring(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  let best = 0;
  let prev = new Array<number>(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    const cur = new Array<number>(y.length + 1).fill(0);
    for (let j = 1; j <= y.length; j++) {
      if (x[i - 1] === y[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best;
}

/** Two headlines sharing a long fragment ("gemini4carbon") are about the same event. */
function sameEvent(a: NewsItem, b: NewsItem): boolean {
  return longestCommonSubstring(titleFingerprint(displayTitle(a)), titleFingerprint(displayTitle(b))) >= 8;
}

/**
 * Highest-scoring items with at most two per category and two from community sources. Without AI
 * titles, items that already have a Chinese title are far more useful to the reader, so they get a boost.
 */
export function pickHighlights(items: NewsItem[], max = 5): NewsItem[] {
  const weight = (i: NewsItem) => i.score + (i.lang === "zh" || i.ai?.title ? 12 : 0);
  const sorted = [...items].sort((a, b) => weight(b) - weight(a));
  const perCategory = new Map<string, number>();
  let community = 0;
  const picked: NewsItem[] = [];
  for (const item of sorted) {
    if (picked.length >= max) break;
    const n = perCategory.get(item.category) ?? 0;
    if (n >= 2) continue;
    if (item.sourceGroup === "community" && community >= 2) continue;
    if (picked.some((p) => sameEvent(p, item))) continue;
    perCategory.set(item.category, n + 1);
    if (item.sourceGroup === "community") community++;
    picked.push(item);
  }
  return picked;
}

export function buildFallbackDigest(items: NewsItem[]): { overview: string; points: DigestPoint[] } {
  const counts = CATEGORIES.map((c) => ({ label: c.label, n: items.filter((i) => i.category === c.id).length }))
    .filter((c) => c.n > 0)
    .sort((a, b) => b.n - a.n);
  const breakdown = counts.map((c) => `${c.label} ${c.n} 条`).join("、");
  const overview = items.length
    ? `过去 24 小时共收录 ${items.length} 条 AI 资讯${breakdown ? `：${breakdown}` : ""}。以下为按热度自动摘录的重点。`
    : "过去 24 小时暂无新的 AI 资讯。";
  const points = pickHighlights(items).map((item) => ({
    text: `【${CATEGORY_MAP[item.category].short}】${displayTitle(item)}`,
    refs: [item.id],
  }));
  return { overview, points };
}
