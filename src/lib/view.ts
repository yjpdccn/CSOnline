import type {
  CategoryId,
  Digest,
  Lang,
  LlmRunResult,
  Metrics,
  NewsItem,
  RelatedStory,
  RunSummary,
  SourceGroup,
  SourceRunResult,
} from "@/lib/types";
import { storyFirstAt, storyWeight } from "@/lib/pipeline/importance";
import { translatedTitle } from "@/lib/pipeline/text";

/** Trimmed item shape sent to the browser. */
export interface ClientItem {
  id: string;
  url: string;
  title: string;
  /** Original English title when `title` is an AI translation. */
  originalTitle?: string;
  summary?: string;
  aiSummary?: boolean;
  lang: Lang;
  sourceId: string;
  sourceName: string;
  sourceGroup: SourceGroup;
  category: CategoryId;
  publishedAt: string;
  dateOnly?: boolean;
  score: number;
  /** Time-independent importance; the page ranks by it after recency (lib/rank.ts). */
  weight: number;
  /** Earliest report of the story when it predates `publishedAt`; recency counts from here. */
  firstAt?: string;
  metrics?: Metrics;
  discussionUrl?: string;
  /** Other reports of the same event, shown as 也见于 links. */
  alsoOn?: ClientAlsoOn[];
  topics?: string[];
}

export interface ClientAlsoOn {
  sourceId: string;
  name: string;
  url: string;
  /** Headline of that report; absent for bare discussion links. */
  title?: string;
  publishedAt?: string;
}

export interface ClientDay {
  day: string;
  items: ClientItem[];
}

export interface DigestRef {
  id: string;
  title: string;
  url: string;
  sourceName: string;
}

export interface ClientDigest {
  day: string;
  generatedAt: string;
  mode: Digest["mode"];
  model?: string;
  overview: string;
  points: { text: string; refs: DigestRef[] }[];
  itemCount: number;
}

export interface SourceOption {
  id: string;
  name: string;
  group: SourceGroup;
}

export interface RunInfo {
  finishedAt: string;
  durationMs: number;
  trigger: string;
  ok: boolean;
  error?: string;
  totals: RunSummary["totals"];
  sources: SourceRunResult[];
  llm: LlmRunResult;
}

export interface HomeData {
  days: ClientDay[];
  dayIndex: { day: string; count: number }[];
  digest: ClientDigest | null;
  lastRun: RunInfo | null;
  sources: SourceOption[];
  /** Start of the last update: the reference time for ranking, the same one 今日要点 used. */
  rankedAt: string | null;
}

export interface RefreshStatus {
  running: boolean;
  startedAt?: string;
  finishedAt?: string;
  progress?: { stage: string; done: number; total: number; message: string };
  lastError?: string;
  lastResult?: { added: number; ok: boolean; error?: string; finishedAt: string; failedSources: number };
}

function clip(text: string | undefined, max: number): string | undefined {
  if (!text) return undefined;
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max - 1).join("") + "…";
}

function alsoOnLinks(item: NewsItem): ClientAlsoOn[] | undefined {
  const entries: RelatedStory[] = [...(item.related ?? []), ...(item.alsoOn ?? [])];
  const links: ClientAlsoOn[] = [];
  const seen = new Set([item.url]);
  for (const a of entries) {
    if (seen.has(a.url)) continue;
    seen.add(a.url);
    const link: ClientAlsoOn = { sourceId: a.sourceId, name: a.sourceName, url: a.url };
    if (a.title) link.title = clip(a.title, 120);
    if (a.publishedAt) link.publishedAt = a.publishedAt;
    links.push(link);
  }
  return links.length ? links : undefined;
}

export function toClientItem(item: NewsItem): ClientItem {
  const aiTitle = translatedTitle(item);
  const client: ClientItem = {
    id: item.id,
    url: item.url,
    title: aiTitle || item.title,
    originalTitle: aiTitle ? item.title : undefined,
    summary: clip(item.ai?.summary || item.excerpt, 180),
    aiSummary: item.ai?.summary ? true : undefined,
    lang: item.lang,
    sourceId: item.sourceId,
    sourceName: item.sourceName,
    sourceGroup: item.sourceGroup,
    category: item.category,
    publishedAt: item.publishedAt,
    dateOnly: item.dateOnly,
    score: item.score,
    weight: storyWeight(item),
    firstAt: storyFirstAt(item),
    metrics: item.metrics,
    discussionUrl: item.discussionUrl,
    alsoOn: alsoOnLinks(item),
    topics: item.keywords,
  };
  for (const key of Object.keys(client) as (keyof ClientItem)[]) {
    if (client[key] === undefined) delete client[key];
  }
  return client;
}

export function toRunInfo(run: RunSummary | undefined): RunInfo | null {
  if (!run) return null;
  return {
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    trigger: run.trigger,
    ok: run.ok,
    error: run.error,
    totals: run.totals,
    sources: run.sources,
    llm: run.llm,
  };
}
