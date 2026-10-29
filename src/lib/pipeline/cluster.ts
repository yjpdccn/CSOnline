import { SOURCES } from "@/config/sources";
import { computeScore } from "./score";
import { compareFeatures, conflictReason, isRoundup, storyFeatures, type MatchResult, type StoryFeatures } from "./similarity";
import { titleFingerprint, titleSimilarity, translatedTitle } from "./text";
import type { Metrics, NewsItem, RelatedStory, StorySignals } from "@/lib/types";

const HOUR = 3_600_000;
/** Reports of one event normally land within three days of each other. */
const WINDOW_MS = 72 * HOUR;
/** Repo and model pages carry their creation date, which can be days before anyone writes about them. */
const ARTIFACT_WINDOW_MS = 7 * 24 * HOUR;
/** A shared headline model only proves a shared launch when the reports are close together. */
const MODEL_MATCH_MS = 36 * HOUR;

const ARTIFACT_SOURCES = new Set(["github-trending", "github-new", "hf-models"]);

const OFFICIAL_HOSTS = new Set(
  SOURCES.filter((s) => s.group === "official").flatMap((s) => {
    try {
      const host = new URL(s.url).hostname.replace(/^www\./, "");
      return host === "huggingface.co" ? [] : [host, host.replace(/^(?:api-docs|blogs|news|feeds)\./, "")];
    } catch {
      return [];
    }
  }),
);

/** Pairs an LLM judged to be the same event, keyed by `pairKey`. Only ever adds merges. */
export type SameEventHints = ReadonlySet<string>;

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

interface StoryRef {
  item: NewsItem;
  time: number;
  features: StoryFeatures;
  /** Features of the AI's Chinese title for an English item. */
  translated?: StoryFeatures;
  roundup: boolean;
  artifact: boolean;
  excerptPrint?: string;
}

function prepare(item: NewsItem, generic?: ReadonlySet<string>): StoryRef {
  const artifact = ARTIFACT_SOURCES.has(item.sourceId);
  const description = artifact ? item.excerpt : undefined;
  const aiTitle = translatedTitle(item);
  const excerptPrint = item.excerpt && Array.from(item.excerpt).length >= 60 ? titleFingerprint(item.excerpt) : undefined;
  return {
    item,
    time: Date.parse(item.publishedAt),
    features: storyFeatures(item.title, { description, generic }),
    translated: aiTitle ? storyFeatures(aiTitle, { generic }) : undefined,
    roundup: isRoundup(item),
    artifact,
    excerptPrint,
  };
}

/** Headline pairs worth comparing; a machine translation is only held against a real Chinese headline. */
function featurePairs(a: StoryRef, b: StoryRef): [StoryFeatures, StoryFeatures][] {
  const pairs: [StoryFeatures, StoryFeatures][] = [[a.features, b.features]];
  if (a.translated && b.item.lang === "zh") pairs.push([a.translated, b.features]);
  if (b.translated && a.item.lang === "zh") pairs.push([a.features, b.translated]);
  return pairs;
}

export interface PairDecision extends MatchResult {
  same: boolean;
}

export interface ClusterOptions {
  /** Reports further apart are never the same event; defaults to 72 hours. Daily recurring headlines need less. */
  windowMs?: number;
  /** Domain words that say little about which event a headline reports (see FeatureOptions.generic). */
  generic?: ReadonlySet<string>;
}

function decide(a: StoryRef, b: StoryRef, hints?: SameEventHints, windowMs = WINDOW_MS): PairDecision {
  const none = (reason: string): PairDecision => ({ same: false, strength: "none", score: 0, reason });
  if (a.roundup || b.roundup) return none("汇总类文章");
  const gap = Math.abs(a.time - b.time);
  if (gap > (a.artifact || b.artifact ? ARTIFACT_WINDOW_MS : windowMs)) return none("时间相隔太远");
  const sameSource = a.item.sourceId === b.item.sourceId;

  const veto = conflictReason(a.features, b.features);
  if (veto) return none(veto);
  if (a.excerptPrint && b.excerptPrint && titleSimilarity(a.excerptPrint, b.excerptPrint) >= 0.9) {
    return { same: true, strength: "strong", score: 1, reason: "摘要相同" };
  }
  const rank = (r: MatchResult) => (r.strength === "strong" ? 2 : r.strength === "normal" ? 1 : 0) + r.score / 10;
  let best: MatchResult = { strength: "none", score: 0, reason: "" };
  for (const [fa, fb] of featurePairs(a, b)) {
    let m = compareFeatures(fa, fb);
    if (m.byModel && gap > MODEL_MATCH_MS) m = { ...m, strength: m.overlapOk ? "normal" : "none" };
    if (rank(m) > rank(best)) best = m;
  }
  // A source rarely files two reports of one event; when it does (a podcast plus a video, an analysis
  // after the news), only strong evidence counts.
  if (sameSource) return { ...best, same: best.strength === "strong" };
  if (best.strength !== "none") return { ...best, same: true };
  if (hints?.has(pairKey(a.item.id, b.item.id))) return { same: true, strength: "normal", score: best.score, reason: "AI 判断为同一事件" };
  return { ...best, same: false };
}

/** Exposed for tests and the tuning script: would these two items be merged? */
export function compareItems(a: NewsItem, b: NewsItem, hints?: SameEventHints, options: ClusterOptions = {}): PairDecision {
  return decide(prepare(a, options.generic), prepare(b, options.generic), hints, options.windowMs);
}

export function isOfficial(item: Pick<NewsItem, "sourceGroup" | "url">): boolean {
  if (item.sourceGroup === "official") return true;
  try {
    const u = new URL(item.url);
    const host = u.hostname.replace(/^www\./, "");
    return OFFICIAL_HOSTS.has(host) || (host === "huggingface.co" && u.pathname.startsWith("/blog/"));
  } catch {
    return false;
  }
}

const GROUP_INFO: Record<NewsItem["sourceGroup"], number> = { official: 3, "media-zh": 3, "media-en": 2.5, blogger: 2, community: 1 };

/** How much a reader learns from the card itself: source type, a Chinese headline, a summary. */
function informativeness(item: NewsItem): number {
  let score = GROUP_INFO[item.sourceGroup] ?? 1;
  if (ARTIFACT_SOURCES.has(item.sourceId)) score -= 1;
  if (item.lang === "zh" || item.ai?.title) score += 1;
  if (item.ai?.summary || Array.from(item.excerpt ?? "").length >= 40) score += 0.5;
  if (/测试|未发布|test post/i.test(item.title)) score -= 5;
  return score;
}

const engagement = (item: NewsItem) => (item.metrics?.points ?? 0) + (item.metrics?.comments ?? 0);

/**
 * Official announcement first (an official blog, or a post that links straight to one); among several,
 * the one discussed most (e.g. on Hacker News), then the one the other reports echo most. Otherwise the
 * most informative report, earliest on ties.
 */
function pickPrimary(members: StoryRef[], scores: Map<string, number>): StoryRef {
  const centrality = (m: StoryRef) => scores.get(m.item.id) ?? 0;
  return [...members].sort((a, b) => {
    const oa = isOfficial(a.item) ? 0 : 1;
    const ob = isOfficial(b.item) ? 0 : 1;
    if (oa !== ob) return oa - ob;
    if (oa === 0) return engagement(b.item) - engagement(a.item) || centrality(b) - centrality(a) || a.time - b.time;
    return informativeness(b.item) - informativeness(a.item) || a.time - b.time;
  })[0];
}

export interface Cluster {
  primary: NewsItem;
  members: NewsItem[];
}

/**
 * Groups items about the same event. Items are taken in time order and join the cluster holding
 * their best match (single link), so each cluster is anchored on the earliest reports.
 */
export function clusterItems(items: NewsItem[], hints?: SameEventHints, options: ClusterOptions = {}): Cluster[] {
  const refs = items.map((item) => prepare(item, options.generic)).sort((a, b) => a.time - b.time || a.item.id.localeCompare(b.item.id));
  const clusters: { members: StoryRef[]; latest: number; scores: Map<string, number> }[] = [];
  const reach = refs.some((r) => r.artifact) ? ARTIFACT_WINDOW_MS : (options.windowMs ?? ARTIFACT_WINDOW_MS);
  for (const ref of refs) {
    let best: (typeof clusters)[number] | undefined;
    let bestScore = -1;
    const pairScores: [StoryRef, number][] = [];
    if (!ref.roundup) {
      for (const cluster of clusters) {
        if (ref.time - cluster.latest > reach) continue;
        let clusterBest = -1;
        const local: [StoryRef, number][] = [];
        for (const member of cluster.members) {
          const d = decide(ref, member, hints, options.windowMs);
          if (!d.same) continue;
          local.push([member, d.score]);
          clusterBest = Math.max(clusterBest, d.score);
        }
        if (clusterBest > bestScore) {
          best = cluster;
          bestScore = clusterBest;
          pairScores.splice(0, pairScores.length, ...local);
        }
      }
    }
    if (best) {
      best.members.push(ref);
      best.latest = Math.max(best.latest, ref.time);
      for (const [member, score] of pairScores) {
        best.scores.set(member.item.id, (best.scores.get(member.item.id) ?? 0) + score);
        best.scores.set(ref.item.id, (best.scores.get(ref.item.id) ?? 0) + score);
      }
    } else {
      clusters.push({ members: [ref], latest: ref.time, scores: new Map() });
    }
  }
  return clusters.map((c) => {
    const primary = pickPrimary(c.members, c.scores);
    return { primary: primary.item, members: c.members.filter((m) => m !== primary).map((m) => m.item) };
  });
}

function mergedMetrics(items: NewsItem[]): Metrics | undefined {
  const merged: Metrics = {};
  for (const item of items) {
    for (const [k, v] of Object.entries(item.metrics ?? {}) as [keyof Metrics, number][]) {
      if (v > (merged[k] ?? 0)) merged[k] = v;
    }
  }
  return Object.keys(merged).length ? merged : undefined;
}

function relatedEntries(primary: NewsItem, members: NewsItem[]): RelatedStory[] {
  const entries: RelatedStory[] = [];
  const seen = new Set([primary.url, primary.discussionUrl, ...(primary.alsoOn ?? []).map((a) => a.url)]);
  const push = (entry: RelatedStory) => {
    if (seen.has(entry.url)) return;
    seen.add(entry.url);
    entries.push(entry);
  };
  for (const m of [...members].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))) {
    push({
      id: m.id,
      sourceId: m.sourceId,
      sourceName: m.sourceName,
      url: m.discussionUrl && m.sourceGroup === "community" ? m.discussionUrl : m.url,
      title: translatedTitle(m) ?? m.title,
      publishedAt: m.publishedAt,
    });
    for (const a of m.alsoOn ?? []) push({ sourceId: a.sourceId, sourceName: a.sourceName, url: a.url });
  }
  return entries;
}

export interface ClusterOutcome {
  clusters: Cluster[];
  /** Items whose stored fields changed. */
  changed: NewsItem[];
  /** Items that became part of another story in this pass. */
  newlyMerged: number;
}

const snapshot = (item: NewsItem) => JSON.stringify([item.dupOf, item.related, item.story, item.score]);

function storySignals(primary: NewsItem, members: NewsItem[], related: RelatedStory[], metrics: Metrics | undefined): StorySignals {
  const sources = [...new Set([primary.sourceId, ...(primary.alsoOn ?? []).map((a) => a.sourceId), ...related.map((r) => r.sourceId)])];
  const firstPublishedAt = [primary, ...members].map((i) => i.publishedAt).sort()[0];
  const signals: StorySignals = { reports: 1 + (primary.alsoOn?.length ?? 0) + related.length, sources, firstPublishedAt };
  if (metrics) signals.metrics = metrics;
  return signals;
}

/**
 * Re-clusters `items` from scratch and writes the result onto them: members get `dupOf`, the primary
 * gets `related` and a score that reflects how widely the story was covered. Items that point at a
 * primary outside `items` are left alone.
 */
export function applyClusters(items: NewsItem[], hints?: SameEventHints, options?: ClusterOptions): ClusterOutcome {
  const ids = new Set(items.map((i) => i.id));
  const pool = items.filter((i) => !i.dupOf || ids.has(i.dupOf));
  const before = new Map(pool.map((i) => [i.id, snapshot(i)]));
  const wasMember = new Set(pool.filter((i) => i.dupOf).map((i) => i.id));
  const clusters = clusterItems(pool, hints, options);
  let newlyMerged = 0;
  for (const { primary, members } of clusters) {
    delete primary.dupOf;
    const related = relatedEntries(primary, members);
    const metrics = mergedMetrics([primary, ...members]);
    if (related.length) {
      primary.related = related;
      primary.story = storySignals(primary, members, related, metrics);
    } else {
      delete primary.related;
      delete primary.story;
    }
    primary.score = computeScore({ ...primary, metrics });
    for (const member of members) {
      if (!wasMember.has(member.id)) newlyMerged++;
      member.dupOf = primary.id;
      delete member.related;
      delete member.story;
      member.score = computeScore(member);
    }
  }
  const changed = pool.filter((i) => before.get(i.id) !== snapshot(i));
  return { clusters, changed, newlyMerged };
}
