import { computeScore } from "./score";
import type { Metrics, NewsItem } from "@/lib/types";

/** Folds a duplicate into the primary item. Returns true when the primary changed. */
export function mergeDuplicate(primary: NewsItem, dup: NewsItem): boolean {
  let changed = false;
  if (dup.sourceId !== primary.sourceId) {
    const alsoOn = primary.alsoOn ?? [];
    if (!alsoOn.some((a) => a.sourceId === dup.sourceId)) {
      alsoOn.push({ sourceId: dup.sourceId, sourceName: dup.sourceName, url: dup.discussionUrl ?? dup.url });
      primary.alsoOn = alsoOn;
      changed = true;
    }
  }
  if (dup.metrics) {
    const merged: Metrics = { ...primary.metrics };
    for (const [k, v] of Object.entries(dup.metrics) as [keyof Metrics, number][]) {
      if (v > (merged[k] ?? 0)) {
        merged[k] = v;
        changed = true;
      }
    }
    primary.metrics = merged;
  }
  if (!primary.discussionUrl && dup.discussionUrl) {
    primary.discussionUrl = dup.discussionUrl;
    changed = true;
  }
  if (!primary.excerpt && dup.excerpt && dup.lang === primary.lang) {
    primary.excerpt = dup.excerpt;
    changed = true;
  }
  if (changed) primary.score = computeScore(primary);
  return changed;
}

/**
 * Finds the stored item with the same key (same URL, GitHub repo or paper). Such duplicates are
 * folded in on arrival; other reports of the same event are stored and grouped by `applyClusters`.
 */
export class Deduper {
  private byKey = new Map<string, NewsItem>();

  constructor(items: NewsItem[]) {
    for (const item of items) this.add(item);
  }

  add(item: NewsItem) {
    this.byKey.set(item.key, item);
  }

  findByKey(key: string): NewsItem | undefined {
    return this.byKey.get(key);
  }
}
