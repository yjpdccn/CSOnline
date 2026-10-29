export type CategoryId =
  | "model"
  | "agent"
  | "multimodal"
  | "opensource"
  | "paper"
  | "industry";

export type SourceGroup =
  | "official"
  | "community"
  | "blogger"
  | "media-zh"
  | "media-en";

export type Lang = "zh" | "en";

export type FetcherType =
  | "rss"
  | "hackernews"
  | "reddit"
  | "anthropic"
  | "github-trending"
  | "github-search"
  | "hf-papers"
  | "hf-models"
  | "seed"
  | "qwen"
  | "deepseek"
  | "jiqizhixin"
  | "kr36";

export interface SourceConfig {
  id: string;
  name: string;
  group: SourceGroup;
  type: FetcherType;
  url: string;
  /** Defaults to true. Disabled sources are kept for reference but never fetched. */
  enabled?: boolean;
  /** Source only publishes AI content, so the keyword filter is skipped. */
  aiFocused?: boolean;
  /** Every item from this source gets this category. */
  category?: CategoryId;
  /** Category used when no keyword rule matches (instead of "industry"). */
  defaultCategory?: CategoryId;
  /** Forces the language instead of detecting it from the title. */
  lang?: Lang;
  /** Max items taken from a single fetch. */
  limit?: number;
  options?: Record<string, string | number | boolean>;
  note?: string;
}

export interface Metrics {
  points?: number;
  comments?: number;
  stars?: number;
  starsToday?: number;
  upvotes?: number;
  likes?: number;
}

/** What a fetcher returns before filtering, dedupe and categorization. */
export interface RawItem {
  title: string;
  url: string;
  excerpt?: string;
  publishedAt?: string;
  lang?: Lang;
  category?: CategoryId;
  metrics?: Metrics;
  discussionUrl?: string;
  /** Extra URL used only for dedupe, e.g. the external link of a Reddit post. */
  externalUrl?: string;
  /** Explicit dedupe key such as `gh:owner/repo` or `arxiv:2410.12345`. */
  key?: string;
  /** Skip AI summarization (e.g. model ids where an LLM would only guess). */
  skipLlm?: boolean;
  /** Source only gives a date; the time of day is unknown and hidden in the UI. */
  dateOnly?: boolean;
  /** Text checked by the AI keyword filter instead of the title (e.g. repo name + description). */
  relevanceText?: string;
}

export interface AlsoOn {
  sourceId: string;
  sourceName: string;
  url: string;
}

export interface AiSummary {
  title?: string;
  summary?: string;
  category?: CategoryId;
  model: string;
  at: string;
}

export interface NewsItem {
  id: string;
  key: string;
  title: string;
  url: string;
  excerpt?: string;
  lang: Lang;
  sourceId: string;
  sourceName: string;
  sourceGroup: SourceGroup;
  publishedAt: string;
  dateOnly?: boolean;
  firstSeenAt: string;
  /** YYYY-MM-DD in the configured timezone, derived from publishedAt. */
  day: string;
  category: CategoryId;
  /** Category came from source config and must not be overridden. */
  categoryLocked?: boolean;
  keywords?: string[];
  score: number;
  metrics?: Metrics;
  discussionUrl?: string;
  alsoOn?: AlsoOn[];
  ai?: AiSummary;
  aiAttempts?: number;
  skipLlm?: boolean;
}

export interface DayFile {
  day: string;
  items: NewsItem[];
}

export interface DigestPoint {
  text: string;
  refs: string[];
}

export interface Digest {
  day: string;
  generatedAt: string;
  mode: "ai" | "fallback";
  model?: string;
  overview: string;
  points: DigestPoint[];
  itemCount: number;
}

export interface SourceRunResult {
  id: string;
  name: string;
  ok: boolean;
  fetched: number;
  relevant: number;
  added: number;
  ms: number;
  error?: string;
}

export interface LlmRunResult {
  enabled: boolean;
  provider?: string;
  model?: string;
  requests: number;
  summarized: number;
  failed: number;
  digest: "ai" | "fallback" | "skipped";
  error?: string;
}

export interface RunSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  trigger: string;
  ok: boolean;
  error?: string;
  totals: {
    fetched: number;
    relevant: number;
    added: number;
    merged: number;
  };
  sources: SourceRunResult[];
  llm: LlmRunResult;
}

export interface MetaFile {
  lastRun?: RunSummary;
  history: Omit<RunSummary, "sources">[];
}

export type RefreshStage =
  | "starting"
  | "fetching"
  | "processing"
  | "summarizing"
  | "digest"
  | "saving"
  | "done";

export interface RefreshProgress {
  stage: RefreshStage;
  done: number;
  total: number;
  message: string;
}
