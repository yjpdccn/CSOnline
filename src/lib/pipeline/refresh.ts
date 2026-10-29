import { ENABLED_SOURCES } from "@/config/sources";
import { SITE } from "@/config/site";
import { Deduper, mergeDuplicate } from "./dedupe";
import { buildFallbackDigest } from "./digest";
import { FETCHERS } from "./fetchers";
import { normalizeError } from "./http";
import { generateAiDigest, getLlmConfig, LlmClient, summarizeItems } from "./llm";
import { isRelevant, parsePublished, toNewsItem } from "./normalize";
import { acquireLock, loadStore, readDay, saveStore, type Store } from "./store";
import { dayKey } from "@/lib/time";
import type {
  Digest,
  LlmRunResult,
  NewsItem,
  RawItem,
  RefreshProgress,
  RunSummary,
  SourceConfig,
  SourceGroup,
  SourceRunResult,
} from "@/lib/types";

export interface RefreshOptions {
  trigger?: string;
  sources?: SourceConfig[];
  onProgress?: (progress: RefreshProgress) => void;
  now?: Date;
  /** Skip AI summaries even when a key is configured. */
  noLlm?: boolean;
}

const GROUP_PRIORITY: Record<SourceGroup, number> = {
  official: 0,
  "media-zh": 1,
  "media-en": 2,
  blogger: 3,
  community: 4,
};

const FETCH_CONCURRENCY = 6;
const DEFAULT_SOURCE_LIMIT = 40;
/** Items without an AI summary from this many recent days are eligible for summarization. */
const LLM_BACKFILL_DAYS = 3;
const MAX_AI_ATTEMPTS = 2;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function ensureDay(store: Store, day: string): Promise<NewsItem[]> {
  let items = store.days.get(day);
  if (!items) {
    items = (await readDay(day))?.items ?? [];
    store.days.set(day, items);
  }
  return items;
}

export async function runRefresh(opts: RefreshOptions = {}): Promise<RunSummary> {
  const release = await acquireLock();
  try {
    return await refreshLocked(opts);
  } finally {
    await release();
  }
}

async function refreshLocked(opts: RefreshOptions): Promise<RunSummary> {
  const now = opts.now ?? new Date();
  const startedAt = new Date();
  const progress = (p: RefreshProgress) => opts.onProgress?.(p);
  const sources = [...(opts.sources ?? ENABLED_SOURCES)].sort(
    (a, b) => GROUP_PRIORITY[a.group] - GROUP_PRIORITY[b.group],
  );

  progress({ stage: "starting", done: 0, total: sources.length, message: "读取已有数据" });
  const windowDays = Math.max(14, SITE.maxItemAgeDays + 2);
  const store = await loadStore(windowDays, now);

  let fetchedCount = 0;
  const fetched = await mapLimit(sources, FETCH_CONCURRENCY, async (source) => {
    const started = Date.now();
    let raws: RawItem[] = [];
    let error: string | undefined;
    try {
      raws = await FETCHERS[source.type](source);
    } catch (err) {
      error = normalizeError(err).message;
    }
    fetchedCount++;
    progress({ stage: "fetching", done: fetchedCount, total: sources.length, message: `抓取来源 ${fetchedCount}/${sources.length}` });
    return { source, raws, error, ms: Date.now() - started };
  });

  progress({ stage: "processing", done: 0, total: 1, message: "过滤、去重与分类" });
  const existing = [...store.days.values()].flat();
  const deduper = new Deduper(existing);
  const minTime = now.getTime() - SITE.maxItemAgeDays * 86_400_000;
  const sourceResults: SourceRunResult[] = [];
  let added = 0;
  let merged = 0;
  let relevantTotal = 0;

  for (const { source, raws, error, ms } of fetched) {
    const result: SourceRunResult = { id: source.id, name: source.name, ok: !error, fetched: raws.length, relevant: 0, added: 0, ms, error };
    const fresh = raws
      .filter((raw) => raw.title && raw.url)
      .filter((raw) => parsePublished(raw, now).getTime() >= minTime)
      .filter((raw) => isRelevant(raw, source))
      .slice(0, source.limit ?? DEFAULT_SOURCE_LIMIT);
    result.relevant = fresh.length;
    relevantTotal += fresh.length;

    for (const raw of fresh) {
      const candidate = toNewsItem(raw, source, now);
      if (!candidate) continue;
      const sameKey = deduper.findByKey(candidate.key);
      if (sameKey) {
        const before = sameKey.alsoOn?.length ?? 0;
        if (mergeDuplicate(sameKey, candidate)) store.dirtyDays.add(sameKey.day);
        if ((sameKey.alsoOn?.length ?? 0) > before) merged++;
        continue;
      }
      if (store.seen[candidate.key]) continue;
      const similar = deduper.findSimilar(candidate);
      if (similar) {
        if (mergeDuplicate(similar, candidate)) store.dirtyDays.add(similar.day);
        store.seen[candidate.key] = similar.day;
        merged++;
        continue;
      }
      const dayItems = await ensureDay(store, candidate.day);
      dayItems.push(candidate);
      deduper.add(candidate);
      store.seen[candidate.key] = candidate.day;
      store.dirtyDays.add(candidate.day);
      result.added++;
      added++;
    }
    sourceResults.push(result);
  }

  const { llm, client } = await summarize(store, now, opts, progress);

  progress({ stage: "digest", done: 0, total: 1, message: "生成今日要点" });
  const digest = await buildDigest(store, now, llm, client);
  if (digest) store.digests[digest.day] = digest;

  const finishedAt = new Date();
  const summary: RunSummary = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    trigger: opts.trigger ?? "manual",
    ok: sourceResults.some((s) => s.ok),
    error: sourceResults.every((s) => !s.ok) ? "所有来源都抓取失败，请检查网络" : undefined,
    totals: { fetched: fetched.reduce((n, f) => n + f.raws.length, 0), relevant: relevantTotal, added, merged },
    sources: sourceResults.sort((a, b) => sources.findIndex((s) => s.id === a.id) - sources.findIndex((s) => s.id === b.id)),
    llm,
  };

  progress({ stage: "saving", done: 0, total: 1, message: "保存数据" });
  store.meta.lastRun = summary;
  store.meta.history = [historyEntry(summary), ...store.meta.history];
  await saveStore(store, now);
  progress({ stage: "done", done: 1, total: 1, message: `完成，新增 ${added} 条` });
  return summary;
}

function historyEntry(summary: RunSummary): Omit<RunSummary, "sources"> {
  const entry: Partial<RunSummary> = { ...summary };
  delete entry.sources;
  return entry as Omit<RunSummary, "sources">;
}

async function summarize(
  store: Store,
  now: Date,
  opts: RefreshOptions,
  progress: (p: RefreshProgress) => void,
): Promise<{ llm: LlmRunResult; client: LlmClient | null }> {
  const { config, reason } = getLlmConfig();
  if (!config || opts.noLlm) {
    return {
      llm: { enabled: false, requests: 0, summarized: 0, failed: 0, digest: "fallback", error: opts.noLlm ? "本次运行跳过 AI 摘要" : reason },
      client: null,
    };
  }
  const client = new LlmClient(config);
  const cutoff = now.getTime() - LLM_BACKFILL_DAYS * 86_400_000;
  const pending = [...store.days.values()]
    .flat()
    .filter((i) => !i.ai && !i.skipLlm && (i.aiAttempts ?? 0) < MAX_AI_ATTEMPTS && Date.parse(i.publishedAt) >= cutoff)
    .sort((a, b) => (a.lang === b.lang ? b.score - a.score : a.lang === "en" ? -1 : 1));

  const outcome = await summarizeItems(client, pending, (done, total) =>
    progress({ stage: "summarizing", done, total, message: `生成 AI 摘要 ${done}/${total} 批` }),
  );
  const touched = new Set(pending.filter((i) => i.ai || i.aiAttempts).map((i) => i.day));
  for (const day of touched) store.dirtyDays.add(day);
  return {
    llm: {
      enabled: true,
      provider: config.provider,
      model: config.model,
      requests: client.requests,
      summarized: outcome.summarized,
      failed: outcome.failed,
      digest: "fallback",
      error: outcome.fatal ?? outcome.error,
    },
    client: outcome.fatal ? null : client,
  };
}

async function buildDigest(
  store: Store,
  now: Date,
  llm: LlmRunResult,
  client: LlmClient | null,
): Promise<Digest | null> {
  const all = [...store.days.values()].flat();
  let window = all.filter((i) => now.getTime() - Date.parse(i.publishedAt) <= 24 * 3_600_000);
  if (window.length < 5) window = all.filter((i) => now.getTime() - Date.parse(i.publishedAt) <= 48 * 3_600_000);
  if (window.length === 0) return null;
  const top = [...window].sort((a, b) => b.score - a.score).slice(0, 30);
  const base = { day: dayKey(now), generatedAt: new Date().toISOString(), itemCount: window.length };

  if (client) {
    try {
      const result = await generateAiDigest(client, top);
      llm.digest = "ai";
      llm.requests = client.requests;
      return { ...base, mode: "ai", model: client.config.model, ...result };
    } catch (err) {
      llm.requests = client.requests;
      llm.error = llm.error ?? `今日要点生成失败：${(err as Error).message}`;
    }
  }
  llm.digest = "fallback";
  return { ...base, mode: "fallback", ...buildFallbackDigest(window) };
}
