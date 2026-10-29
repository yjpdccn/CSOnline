import { computeScore } from "./score";
import { titleFingerprint, titleSimilarity } from "./text";
import type { Metrics, NewsItem } from "@/lib/types";

const SIMILARITY_THRESHOLD = 0.8;
const MIN_FINGERPRINT_LENGTH = 10;
/** "Gemini 4 Carbon" vs "Gemini 4 Carbon: Our next frontier model": a long shared prefix is the same story. */
const MIN_PREFIX_LENGTH = 12;
const WINDOW_MS = 3 * 86_400_000;

function sameStory(a: string, b: string, sameLang: boolean): number {
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (sameLang && Array.from(shorter).length >= MIN_PREFIX_LENGTH && longer.startsWith(shorter)) return 1;
  return titleSimilarity(a, b);
}

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

interface Indexed {
  item: NewsItem;
  fingerprint: string;
  time: number;
}

/**
 * Finds the stored item a candidate duplicates: same key first (same URL, repo or paper),
 * then a near-identical title from a different source within a few days.
 */
export class Deduper {
  private byKey = new Map<string, NewsItem>();
  private indexed: Indexed[] = [];

  constructor(items: NewsItem[]) {
    for (const item of items) this.add(item);
  }

  add(item: NewsItem) {
    this.byKey.set(item.key, item);
    this.indexed.push({ item, fingerprint: titleFingerprint(item.title), time: Date.parse(item.publishedAt) });
  }

  findByKey(key: string): NewsItem | undefined {
    return this.byKey.get(key);
  }

  findSimilar(candidate: NewsItem): NewsItem | undefined {
    const fingerprint = titleFingerprint(candidate.title);
    if (Array.from(fingerprint).length < MIN_FINGERPRINT_LENGTH) return undefined;
    const time = Date.parse(candidate.publishedAt);
    let best: Indexed | undefined;
    let bestScore = 0;
    // Entries are indexed in source-priority order, so on ties the earlier (e.g. official) item wins.
    for (const entry of this.indexed) {
      if (entry.item.sourceId === candidate.sourceId) continue;
      if (Math.abs(entry.time - time) > WINDOW_MS) continue;
      const score = sameStory(entry.fingerprint, fingerprint, entry.item.lang === candidate.lang);
      if (score >= SIMILARITY_THRESHOLD && score > bestScore) {
        best = entry;
        bestScore = score;
      }
    }
    return best?.item;
  }
}
