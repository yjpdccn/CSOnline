/**
 * Importance ordering shared by the page and 今日要点. Each card brings a time-independent
 * `weight` (see pipeline/importance.ts); here it decays with the age of the story's first report,
 * and a greedy pass keeps any one noisy source type from filling the top.
 */

export interface Rankable {
  sourceId: string;
  weight: number;
  publishedAt: string;
  /** Earliest report of the story when earlier than `publishedAt`. */
  firstAt?: string;
}

/** Repo listings are shown in their own compact block, never as ranked cards. */
export const REPO_SOURCES = new Set(["github-trending", "github-new"]);

/** Hours for a story's weight to halve. */
const HALF_LIFE_HOURS = 24;
/** The latest period: 24 hours before the last update, or 48 when that holds too little. */
export const PERIOD_HOURS = 24;
const PERIOD_FALLBACK_HOURS = 48;
const PERIOD_MIN_ITEMS = 5;

/**
 * Each further card from the same noisy source type is worth this much less; listings and
 * discussions come in batches and would otherwise crowd out news.
 */
const BUCKETS: Record<string, { bucket: string; decay: number }> = {
  "hf-models": { bucket: "model-page", decay: 0.5 },
  "hf-papers": { bucket: "paper", decay: 0.6 },
  "reddit-localllama": { bucket: "reddit", decay: 0.6 },
  "github-trending": { bucket: "repo", decay: 0.5 },
  "github-new": { bucket: "repo", decay: 0.5 },
  hackernews: { bucket: "hn", decay: 0.8 },
};
/** Any source, each further card in the same list. */
const SOURCE_DECAY = 0.85;

const HOUR = 3_600_000;

export function recency(ageHours: number): number {
  return Math.pow(0.5, Math.max(0, ageHours) / HALF_LIFE_HOURS);
}

export function storyAge(item: Rankable, now: number): number {
  return (now - Date.parse(item.firstAt ?? item.publishedAt)) / HOUR;
}

/** Weight after recency, before the diversity pass. */
export function rankScore(item: Rankable, now: number): number {
  return item.weight * recency(storyAge(item, now));
}

/** Most important first. `now` is the time of the update, so the order does not drift while a page is open. */
export function rankStories<T extends Rankable>(items: T[], now: number): T[] {
  const pool = items.map((item) => ({ item, score: rankScore(item, now), time: Date.parse(item.publishedAt) }));
  const buckets = new Map<string, number>();
  const sources = new Map<string, number>();
  const ranked: T[] = [];
  while (pool.length) {
    let best = 0;
    let bestScore = -Infinity;
    pool.forEach(({ item, score, time }, index) => {
      const noisy = BUCKETS[item.sourceId];
      const adjusted =
        score * (noisy ? noisy.decay ** (buckets.get(noisy.bucket) ?? 0) : 1) * SOURCE_DECAY ** (sources.get(item.sourceId) ?? 0);
      if (adjusted > bestScore || (adjusted === bestScore && time > pool[best].time)) {
        best = index;
        bestScore = adjusted;
      }
    });
    const [{ item }] = pool.splice(best, 1);
    const noisy = BUCKETS[item.sourceId];
    if (noisy) buckets.set(noisy.bucket, (buckets.get(noisy.bucket) ?? 0) + 1);
    sources.set(item.sourceId, (sources.get(item.sourceId) ?? 0) + 1);
    ranked.push(item);
  }
  return ranked;
}

/** Start of the latest period, shared by the default view and 今日要点. */
export function periodStart(items: Pick<Rankable, "publishedAt">[], now: number): number {
  const within = (hours: number) => items.filter((i) => now - Date.parse(i.publishedAt) <= hours * HOUR).length;
  const hours = within(PERIOD_HOURS) >= PERIOD_MIN_ITEMS ? PERIOD_HOURS : PERIOD_FALLBACK_HOURS;
  return now - hours * HOUR;
}
