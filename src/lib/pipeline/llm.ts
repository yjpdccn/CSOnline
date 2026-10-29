import { CATEGORIES } from "@/config/site";
import { translatedTitle, truncate } from "./text";
import type { CategoryId, DigestPoint, NewsItem } from "@/lib/types";

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  provider: string;
  batchSize: number;
  /** Items summarized per run at most; the rest of the backlog waits for the next scheduled run. */
  maxItems: number;
  /** Summary requests per run at most, retries included. */
  maxRequests: number;
  minIntervalMs: number;
  timeoutMs: number;
  /** Time allowed for summaries in one run, so a slow or overloaded provider cannot hold up the deploy. */
  budgetMs: number;
  extraBody: Record<string, unknown>;
}

/** Used when only LLM_API_KEY is set: glm-4.7-flash is free and reachable from GitHub's runners. */
const DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
/** GitHub Models was retired on 2026-07-30; its hosts now answer every request with a plain-text "OK". */
const RETIRED_HOSTS = /models\.github\.ai|models\.inference\.ai\.azure\.com/;

const PROVIDERS: { match: RegExp; name: string; model?: string; minIntervalMs: number; extraBody?: Record<string, unknown> }[] = [
  // Free tier: no token charges, but a per-account concurrency cap and platform-wide overload (1305) at peak times.
  { match: /bigmodel\.cn|z\.ai/, name: "智谱 GLM", model: "glm-4.7-flash", minIntervalMs: 3000, extraBody: { thinking: { type: "disabled" } } },
  { match: /deepseek\.com/, name: "DeepSeek", model: "deepseek-chat", minIntervalMs: 500 },
  { match: /dashscope/, name: "通义千问", minIntervalMs: 500 },
  { match: /moonshot/, name: "Kimi", minIntervalMs: 1000 },
  { match: /openai\.com/, name: "OpenAI", minIntervalMs: 500 },
];

/** Items from this many recent days are eligible for summarization; older ones keep their original text. */
export const LLM_BACKFILL_DAYS = 3;
/** Answers without a usable summary allowed per item before it is left as is. */
export const MAX_AI_ATTEMPTS = 2;
const MAX_TRIES = 3;
/** No request is started with less than this left before the deadline. */
const MIN_REQUEST_MS = 30_000;
/** A Retry-After longer than this is a quota window rather than a burst limit. */
const MAX_RETRY_AFTER_MS = 120_000;

export interface LlmConfigResult {
  config: LlmConfig | null;
  reason?: string;
}

export function getLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfigResult {
  if (env.LLM_DISABLED === "1" || env.LLM_DISABLED === "true") return { config: null, reason: "已通过 LLM_DISABLED 关闭" };
  const baseUrl = (env.LLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
  if (RETIRED_HOSTS.test(baseUrl)) return { config: null, reason: "GitHub Models 已于 2026-07-30 停止服务，请改用其他接口（见 README）" };
  const provider = PROVIDERS.find((p) => p.match.test(baseUrl));
  const apiKey = env.LLM_API_KEY;
  if (!apiKey) return { config: null, reason: "未配置 LLM_API_KEY" };
  const model = env.LLM_MODEL || provider?.model;
  if (!model) return { config: null, reason: "未配置 LLM_MODEL" };
  let extraBody = provider?.extraBody ?? {};
  if (env.LLM_EXTRA_BODY) {
    try {
      extraBody = { ...extraBody, ...JSON.parse(env.LLM_EXTRA_BODY) };
    } catch {
      return { config: null, reason: "LLM_EXTRA_BODY 不是合法 JSON" };
    }
  }
  const int = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    config: {
      apiKey,
      baseUrl,
      model,
      provider: provider?.name ?? new URL(baseUrl).hostname,
      batchSize: Math.max(1, int(env.LLM_BATCH_SIZE, 20)),
      maxItems: Math.max(0, int(env.LLM_MAX_ITEMS, 100)),
      maxRequests: Math.max(0, int(env.LLM_MAX_REQUESTS, 20)),
      minIntervalMs: int(env.LLM_MIN_INTERVAL_MS, provider?.minIntervalMs ?? 1000),
      timeoutMs: int(env.LLM_TIMEOUT_MS, 150_000),
      budgetMs: int(env.LLM_TIME_BUDGET_MS, 6 * 60_000),
      extraBody,
    },
  };
}

/**
 * Why AI work stopped early: busy = rate limited, overloaded or timing out; limit = this run's item, request or time
 * budget; quota and config need the owner to act.
 */
export type LlmPause = "busy" | "limit" | "quota" | "config";

/** Ends AI work for the rest of this run without counting against any item's attempts. */
export class LlmStop extends Error {
  constructor(
    readonly kind: LlmPause,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "LlmStop";
  }
}

/** The provider's content filter refused this input (智谱 1301). */
class ContentRejected extends Error {}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface LlmClientOptions {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (message: string) => void;
}

function describeError(status: number, text: string): { code?: string; detail: string } {
  let code: string | undefined;
  let message: string | undefined;
  try {
    const error = JSON.parse(text)?.error;
    if (error?.code !== undefined) code = String(error.code);
    if (typeof error?.message === "string") message = error.message;
  } catch {
    // Not JSON: report the raw text instead.
  }
  const tail = message ?? text.slice(0, 160).replace(/\s+/g, " ").trim();
  return { code, detail: `HTTP ${status}${code && code !== String(status) ? ` · ${code}` : ""}${tail ? ` ${tail}` : ""}` };
}

/** Zhipu asks for longer pauses after 1305 (the whole model is overloaded) than after 1302 (this account's limit). */
function backoffMs(attempt: number, code: string | undefined): number {
  const base = code === "1305" ? 20_000 : code === "1302" || code === "1303" ? 10_000 : 5_000;
  return Math.round(base * 2 ** attempt * (1 + Math.random() * 0.25));
}

function retryAfterMs(res: Response, now: number): number | undefined {
  const value = res.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

export class LlmClient {
  private lastRequestAt = Number.NEGATIVE_INFINITY;
  private jsonMode = true;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly log: (message: string) => void;
  requests = 0;

  constructor(
    readonly config: LlmConfig,
    private fetchImpl: typeof fetch = fetch,
    opts: LlmClientOptions = {},
  ) {
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
  }

  /** One request at a time, spaced by minIntervalMs; rate limits, overload and timeouts are retried until `deadline`. */
  async chatJson<T>(messages: ChatMessage[], { maxTokens, deadline }: { maxTokens: number; deadline: number }): Promise<T> {
    const { baseUrl, apiKey, model, timeoutMs, minIntervalMs, extraBody } = this.config;
    let lastDetail = "";
    let badOutput = false;
    for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
      const wait = Math.max(0, this.lastRequestAt + minIntervalMs - this.now());
      if (this.now() + wait + MIN_REQUEST_MS > deadline) {
        throw new LlmStop("limit", "本次运行的 AI 摘要时间已用完", lastDetail || undefined);
      }
      if (wait > 0) await this.sleep(wait);
      this.lastRequestAt = this.now();
      this.requests++;
      const timeout = Math.max(MIN_REQUEST_MS, Math.min(timeoutMs, deadline - this.now()));
      let res: Response;
      try {
        res = await this.fetchImpl(`${baseUrl}/chat/completions`, {
          method: "POST",
          signal: AbortSignal.timeout(timeout),
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.2,
            max_tokens: maxTokens,
            ...(this.jsonMode ? { response_format: { type: "json_object" } } : {}),
            ...extraBody,
          }),
        });
      } catch (err) {
        badOutput = false;
        lastDetail = (err as Error).name === "TimeoutError" ? `${Math.round(timeout / 1000)} 秒内没有响应` : `网络错误：${(err as Error).message}`;
        if (await this.backoff(attempt, undefined, undefined, lastDetail, deadline)) continue;
        break;
      }
      const text = await res.text();
      if (res.ok) {
        let body: { choices?: { message?: { content?: string } }[] };
        try {
          body = JSON.parse(text);
        } catch {
          throw new LlmStop("config", "接口返回的不是 JSON，请检查 LLM_BASE_URL", text.slice(0, 80).replace(/\s+/g, " ").trim() || "空响应");
        }
        try {
          return parseJsonContent<T>(body.choices?.[0]?.message?.content ?? "");
        } catch (err) {
          badOutput = true;
          lastDetail = `无法解析模型输出：${(err as Error).message}`;
          continue;
        }
      }
      badOutput = false;
      const { code, detail } = describeError(res.status, text);
      lastDetail = detail;
      if (res.status === 400 && this.jsonMode && /response_format|json/i.test(text)) {
        this.jsonMode = false;
        continue;
      }
      if (code === "1301") throw new ContentRejected(detail);
      if (res.status === 401 || res.status === 403) throw new LlmStop("config", "密钥无效或无权调用该模型，请检查 LLM_API_KEY", detail);
      if (res.status === 404 || code === "1211") throw new LlmStop("config", "模型或接口不存在，请检查 LLM_MODEL 和 LLM_BASE_URL", detail);
      if (code === "1113") throw new LlmStop("quota", "智谱账户欠费，请到智谱控制台查看余额", detail);
      if (code === "1308" || code === "1310") throw new LlmStop("quota", "已达到智谱的用量上限，额度恢复后的更新会继续生成", detail);
      if (res.status !== 408 && res.status !== 429 && res.status < 500) {
        throw new LlmStop("config", "接口拒绝了请求，请检查模型配置", detail);
      }
      const after = retryAfterMs(res, this.now());
      if (after !== undefined && after > MAX_RETRY_AFTER_MS) {
        throw new LlmStop("quota", `接口要求约 ${Math.ceil(after / 60_000)} 分钟后再试，之后的更新会继续生成`, detail);
      }
      if (await this.backoff(attempt, code, after, detail, deadline)) continue;
      break;
    }
    if (badOutput) throw new Error(lastDetail);
    throw new LlmStop("busy", "模型繁忙", lastDetail);
  }

  /** Waits before the next try; false when no tries or time are left. */
  private async backoff(attempt: number, code: string | undefined, retryAfter: number | undefined, detail: string, deadline: number) {
    if (attempt + 1 >= MAX_TRIES) return false;
    const delay = retryAfter ?? backoffMs(attempt, code);
    if (this.now() + delay + MIN_REQUEST_MS > deadline) return false;
    this.log(`${detail}，${Math.round(delay / 1000)} 秒后重试`);
    await this.sleep(delay);
    return true;
  }
}

export function parseJsonContent<T>(content: string): T {
  const cleaned = content.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as T;
    throw new Error("输出不是 JSON");
  }
}

const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
const CATEGORY_GUIDE = CATEGORIES.map((c) => `${c.id}（${c.label}）`).join(" / ");

// Not "title": under the same key as the input field, the model tends to echo the English headline.
const SUMMARY_SYSTEM = `你是一名 AI 行业资讯编辑，读者是只看中文的用户。输入是一组 JSON 资讯，逐条处理：
1. zh_title：lang 为 en 的条目，把英文标题改写成通顺的中文标题，不超过 30 个汉字，准确克制，不夸张；必须以中文为主，不能照抄英文原标题，只有模型名、产品名、公司名、仓库名等专有名词保留英文（如 GPT-5、Claude、Seedance、owner/repo）。lang 为 zh 的条目输出空字符串。
2. summary：一句话中文摘要，不超过 60 个汉字，说明发生了什么、为什么值得关注。只依据给出的标题和摘要，不得编造数字或细节；信息不足时概括标题即可。
3. category：从 ${CATEGORY_GUIDE} 中选一个 id。
示例：输入 {"id":"a1","lang":"en","title":"OpenAI launches GPT-5.5 with faster reasoning"}，输出 {"id":"a1","zh_title":"OpenAI 发布推理更快的 GPT-5.5","summary":"OpenAI 推出 GPT-5.5，主打更快的推理速度。","category":"model"}。
只输出 JSON：{"items":[{"id":"...","zh_title":"...","summary":"...","category":"..."}]}，id 与输入一致，每条都要输出。`;

interface SummaryResult {
  items?: { id?: string; zh_title?: string; title?: string; summary?: string; category?: string }[];
}

const CHINESE = /[\u3400-\u9fff]/;

/** English items count as done only once they have a Chinese title; merged duplicates are never shown. */
function needsSummary(item: NewsItem): boolean {
  return !item.dupOf && (!item.ai || (item.lang === "en" && !translatedTitle(item)));
}

export interface SummarizeOutcome {
  summarized: number;
  /** Items the model answered for without a usable summary; each used up one attempt. */
  failed: number;
  stop?: LlmStop;
  /** Last batch error that did not stop the run. */
  error?: string;
}

/** Items still waiting for a summary, most useful first: English (untranslated titles), then newest, then hottest. */
export function pendingSummaries(items: NewsItem[], now: Date): NewsItem[] {
  const cutoff = now.getTime() - LLM_BACKFILL_DAYS * 86_400_000;
  return items
    .filter((i) => needsSummary(i) && !i.skipLlm && (i.aiAttempts ?? 0) < MAX_AI_ATTEMPTS && Date.parse(i.publishedAt) >= cutoff)
    .sort((a, b) => (a.lang === b.lang ? b.day.localeCompare(a.day) || b.score - a.score : a.lang === "en" ? -1 : 1));
}

/** Recent items that are fully summarized, and those a later run will still try. */
export function summaryProgress(items: NewsItem[], now: Date): { done: number; pending: number } {
  const cutoff = now.getTime() - LLM_BACKFILL_DAYS * 86_400_000;
  const done = items.filter((i) => !i.dupOf && !needsSummary(i) && Date.parse(i.publishedAt) >= cutoff).length;
  return { done, pending: pendingSummaries(items, now).length };
}

function applySummaries(batch: NewsItem[], result: SummaryResult, model: string, outcome: SummarizeOutcome) {
  const byId = new Map((result.items ?? []).filter((r) => r?.id).map((r) => [String(r.id), r]));
  const at = new Date().toISOString();
  for (const item of batch) {
    const r = byId.get(item.id);
    const summary = r?.summary?.trim();
    if (!summary) {
      item.aiAttempts = (item.aiAttempts ?? 0) + 1;
      outcome.failed++;
      continue;
    }
    const title = [r?.zh_title, r?.title].map((t) => t?.trim()).find((t) => t && CHINESE.test(t));
    if (item.lang === "en" && !title) {
      // The summary is still worth showing; the Chinese title gets another try in a later run.
      item.aiAttempts = (item.aiAttempts ?? 0) + 1;
      if (item.ai) {
        outcome.failed++;
        continue;
      }
    }
    const category = CATEGORY_IDS.includes(r?.category as CategoryId) ? (r!.category as CategoryId) : undefined;
    item.ai = {
      title: item.lang === "en" && title ? truncate(title, 40) : undefined,
      summary: truncate(summary, 90),
      category,
      model,
      at,
    };
    if (category && !item.categoryLocked) item.category = category;
    outcome.summarized++;
  }
}

/**
 * Fills `item.ai` in place for the first `maxItems` items, one request at a time. Rate limits, overload and timeouts
 * end this run's work early but never count against an item, so the backlog simply carries over to the next run.
 */
export async function summarizeItems(
  client: LlmClient,
  items: NewsItem[],
  { deadline, onBatch }: { deadline: number; onBatch?: (done: number, total: number) => void },
): Promise<SummarizeOutcome> {
  const { batchSize, maxItems, maxRequests, model } = client.config;
  const selected = items.slice(0, maxItems);
  const queue: NewsItem[][] = [];
  for (let i = 0; i < selected.length; i += batchSize) queue.push(selected.slice(i, i + batchSize));
  const outcome: SummarizeOutcome = { summarized: 0, failed: 0 };
  let done = 0;
  while (queue.length > 0) {
    if (client.requests >= maxRequests) {
      outcome.stop = new LlmStop("limit", "已达到本次运行的请求上限");
      break;
    }
    onBatch?.(done, done + queue.length);
    const batch = queue.shift()!;
    try {
      const result = await client.chatJson<SummaryResult>(
        [
          { role: "system", content: SUMMARY_SYSTEM },
          {
            role: "user",
            content: JSON.stringify({
              items: batch.map((item) => ({
                id: item.id,
                lang: item.lang,
                source: item.sourceName,
                title: truncate(item.title, 200),
                excerpt: item.excerpt ? truncate(item.excerpt, 280) : "",
              })),
            }),
          },
        ],
        { maxTokens: 600 + 160 * batch.length, deadline },
      );
      applySummaries(batch, result, model, outcome);
    } catch (err) {
      if (err instanceof LlmStop) {
        outcome.stop = err;
        queue.unshift(batch);
        break;
      }
      if (err instanceof ContentRejected) {
        // One refused item would sink the whole batch, so split until it is isolated.
        if (batch.length > 1) {
          const mid = Math.ceil(batch.length / 2);
          queue.unshift(batch.slice(0, mid), batch.slice(mid));
        } else {
          batch[0].aiAttempts = MAX_AI_ATTEMPTS;
          outcome.failed++;
        }
        continue;
      }
      for (const item of batch) item.aiAttempts = (item.aiAttempts ?? 0) + 1;
      outcome.failed += batch.length;
      outcome.error = (err as Error).message;
    }
    done++;
  }
  onBatch?.(done, done + queue.length);
  return outcome;
}

const DIGEST_SYSTEM = `你是 AI 行业日报主编。根据给出的资讯列表（已按重要性排序）写「今日要点」：
- overview：一句话总览今天 AI 圈最值得关注的动向，不超过 60 个汉字。
- points：3 到 5 条要点，每条不超过 45 个汉字，优先模型发布、Agent 与工具、多模态与视频生成、重要开源项目和行业大事；同一事件只写一次；每条附上最相关资讯的 id 列表 refs。
只依据给出的内容，不编造。只输出 JSON：{"overview":"...","points":[{"text":"...","refs":["id"]}]}`;

interface DigestResult {
  overview?: string;
  points?: { text?: string; refs?: string[] }[];
}

export async function generateAiDigest(
  client: LlmClient,
  items: NewsItem[],
  deadline: number,
): Promise<{ overview: string; points: DigestPoint[] }> {
  const ids = new Set(items.map((i) => i.id));
  const payload = items.map((item) => ({
    id: item.id,
    source: item.sourceName,
    category: CATEGORIES.find((c) => c.id === item.category)?.label,
    title: item.ai?.title || item.title,
    summary: truncate(item.ai?.summary || item.excerpt || "", 100),
  }));
  const result = await client.chatJson<DigestResult>(
    [
      { role: "system", content: DIGEST_SYSTEM },
      { role: "user", content: JSON.stringify({ items: payload }) },
    ],
    { maxTokens: 1500, deadline },
  );
  const points = (result.points ?? [])
    .filter((p) => p?.text?.trim())
    .slice(0, 5)
    .map((p) => ({ text: truncate(p.text!.trim(), 60), refs: (p.refs ?? []).map(String).filter((id) => ids.has(id)) }));
  if (!result.overview?.trim() || points.length === 0) throw new Error("模型未返回有效的要点");
  return { overview: truncate(result.overview.trim(), 80), points };
}
