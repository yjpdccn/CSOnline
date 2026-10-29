import { ENABLED_SOURCES } from "@/config/sources";
import { SITE } from "@/config/site";
import { applyClusters } from "./cluster";
import { Deduper, mergeDuplicate } from "./dedupe";
import { AI_DIGEST_CANDIDATES, buildFallbackDigest, followsRanking, rankLatestPeriod } from "./digest";
import { FETCHERS } from "./fetchers";
import { normalizeError } from "./http";
import { generateAiDigest, getLlmConfig, LlmClient, LlmStop, pendingSummaries, summarizeItems, summaryProgress } from "./llm";
import { findSameEventPairs } from "./llm-dedupe";
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
  /** Receives AI retry notices such as rate-limit codes. */
  log?: (message: string) => void;
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
/** Parts of the run's AI time budget kept back from the summaries for the steps after them. */
const DIGEST_RESERVE_MS = 150_000;
const DEDUPE_RESERVE_MS = 90_000;
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
      // Other reports of the same event are kept and grouped by clusterStore below.
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

  merged += clusterStore(store).newlyMerged;

  let llm: LlmRunResult;
  let client: LlmClient | null = null;
  let aiDeadline = 0;
  try {
    ({ llm, client, deadline: aiDeadline } = await summarize(store, now, opts, progress));
  } catch (err) {
    // A bug in the AI step must not cost the run its news or the deploy.
    llm = { enabled: true, requests: 0, summarized: 0, failed: 0, digest: "fallback", notice: "AI 摘要出错，本次已跳过", error: (err as Error).message };
  }
  // The same-event check is optional, so an overloaded model leaves its time to the 今日要点.
  if (client && llm.paused !== "busy") {
    progress({ stage: "summarizing", done: 0, total: 1, message: "AI 合并跨语言重复报道" });
    merged += await llmDedupe(store, client, now, llm, aiDeadline - DIGEST_RESERVE_MS);
  } else if (llm.summarized) {
    merged += clusterStore(store).newlyMerged;
  }

  progress({ stage: "digest", done: 0, total: 1, message: "生成今日要点" });
  const digest = await buildDigest(store, now, llm, client, aiDeadline);
  // An AI-written 今日要点 from an earlier run today beats an automatic one from a run where the model was busy,
  // as long as the stories it cites still top the ranking the page shows.
  const kept = digest ? store.digests[digest.day] : undefined;
  const keepAi = digest?.mode === "fallback" && kept?.mode === "ai" && followsRanking(kept, [...store.days.values()].flat(), now);
  if (digest && !keepAi) store.digests[digest.day] = digest;

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

/** Re-groups every loaded item into stories and marks the days whose items changed. */
export function clusterStore(store: Store) {
  const items = [...store.days.values()].flat();
  const outcome = applyClusters(items, new Set(Object.keys(store.sameEvent)));
  for (const item of outcome.changed) store.dirtyDays.add(item.day);
  return outcome;
}

/** Fresh AI titles can link more reports, then the model is asked about the rest. Returns newly merged items. */
async function llmDedupe(store: Store, client: LlmClient, now: Date, llm: LlmRunResult, deadline: number): Promise<number> {
  const regrouped = clusterStore(store);
  const outcome = await findSameEventPairs(client, regrouped.clusters, now, deadline);
  llm.requests = client.requests;
  if (outcome.fatal || outcome.error) llm.error = llm.error ?? outcome.fatal ?? outcome.error;
  if (!outcome.pairs.length) return regrouped.newlyMerged;
  const day = dayKey(now);
  for (const pair of outcome.pairs) store.sameEvent[pair] = day;
  const confirmed = clusterStore(store).newlyMerged;
  llm.merged = confirmed;
  return regrouped.newlyMerged + confirmed;
}

function historyEntry(summary: RunSummary): Omit<RunSummary, "sources"> {
  const entry: Partial<RunSummary> = { ...summary };
  delete entry.sources;
  return entry as Omit<RunSummary, "sources">;
}

/** Runs the summaries and returns the client with `deadline`, the end of this run's AI time budget. */
async function summarize(
  store: Store,
  now: Date,
  opts: RefreshOptions,
  progress: (p: RefreshProgress) => void,
): Promise<{ llm: LlmRunResult; client: LlmClient | null; deadline: number }> {
  const { config, reason } = getLlmConfig();
  if (!config || opts.noLlm) {
    return {
      llm: { enabled: false, requests: 0, summarized: 0, failed: 0, digest: "fallback", error: opts.noLlm ? "本次运行跳过 AI 摘要" : reason },
      client: null,
      deadline: 0,
    };
  }
  const deadline = Date.now() + config.budgetMs;
  const client = new LlmClient(config, fetch, { log: opts.log });
  const all = [...store.days.values()].flat();
  const pending = pendingSummaries(all, now);
  const outcome = await summarizeItems(client, pending, {
    deadline: deadline - DEDUPE_RESERVE_MS - DIGEST_RESERVE_MS,
    onBatch: (done, total) => progress({ stage: "summarizing", done, total, message: `生成 AI 摘要 ${done}/${total} 批` }),
  });
  for (const day of new Set(pending.filter((i) => i.ai || i.aiAttempts).map((i) => i.day))) store.dirtyDays.add(day);
  const { done, pending: waiting } = summaryProgress(all, now);
  const stop = outcome.stop;
  const blocked = stop?.kind === "quota" || stop?.kind === "config";
  return {
    llm: {
      enabled: true,
      provider: config.provider,
      model: config.model,
      requests: client.requests,
      summarized: outcome.summarized,
      failed: outcome.failed,
      digest: "fallback",
      done,
      pending: waiting,
      paused: stop?.kind ?? (waiting > 0 ? "limit" : undefined),
      notice: blocked ? stop.message : undefined,
      error: stop ? stopDetail(stop) : outcome.error,
    },
    client: blocked ? null : client,
    deadline,
  };
}

function stopDetail(stop: LlmStop): string {
  return stop.detail ? `${stop.message}：${stop.detail}` : stop.message;
}

async function buildDigest(
  store: Store,
  now: Date,
  llm: LlmRunResult,
  client: LlmClient | null,
  deadline: number,
): Promise<Digest | null> {
  const latest = rankLatestPeriod([...store.days.values()].flat().filter((i) => !i.dupOf), now);
  if (latest.period.length === 0) return null;
  // The model writes 今日要点 from the top of the ranking the page shows, in that order.
  const top = latest.ranked.slice(0, AI_DIGEST_CANDIDATES);
  const base = { day: dayKey(now), generatedAt: new Date().toISOString(), itemCount: latest.period.length };

  if (client) {
    try {
      const result = await generateAiDigest(client, top, deadline);
      llm.digest = "ai";
      llm.requests = client.requests;
      return { ...base, mode: "ai", model: client.config.model, ...result };
    } catch (err) {
      llm.requests = client.requests;
      llm.error = llm.error ?? `今日要点：${err instanceof LlmStop ? stopDetail(err) : (err as Error).message}`;
      if (err instanceof LlmStop) {
        llm.paused ??= err.kind;
        if (err.kind === "quota" || err.kind === "config") llm.notice ??= err.message;
      }
    }
  }
  llm.digest = "fallback";
  return { ...base, mode: "fallback", ...buildFallbackDigest(latest) };
}
