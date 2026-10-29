import { CATEGORIES } from "@/config/site";
import { truncate } from "./text";
import type { CategoryId, DigestPoint, NewsItem } from "@/lib/types";

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  provider: string;
  batchSize: number;
  maxRequests: number;
  minIntervalMs: number;
  timeoutMs: number;
  extraBody: Record<string, unknown>;
}

/** Used when only LLM_API_KEY is set: glm-4.7-flash is free and reachable from GitHub's runners. */
const DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
/** GitHub Models was retired on 2026-07-30; its hosts now answer every request with a plain-text "OK". */
const RETIRED_HOSTS = /models\.github\.ai|models\.inference\.ai\.azure\.com/;

const PROVIDERS: { match: RegExp; name: string; model?: string; minIntervalMs: number; extraBody?: Record<string, unknown> }[] = [
  { match: /bigmodel\.cn|z\.ai/, name: "智谱 GLM", model: "glm-4.7-flash", minIntervalMs: 1500, extraBody: { thinking: { type: "disabled" } } },
  { match: /deepseek\.com/, name: "DeepSeek", model: "deepseek-chat", minIntervalMs: 500 },
  { match: /dashscope/, name: "通义千问", minIntervalMs: 500 },
  { match: /moonshot/, name: "Kimi", minIntervalMs: 1000 },
  { match: /openai\.com/, name: "OpenAI", minIntervalMs: 500 },
];

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
      batchSize: Math.max(1, int(env.LLM_BATCH_SIZE, 12)),
      maxRequests: Math.max(0, int(env.LLM_MAX_REQUESTS, 20)),
      minIntervalMs: int(env.LLM_MIN_INTERVAL_MS, provider?.minIntervalMs ?? 1000),
      timeoutMs: int(env.LLM_TIMEOUT_MS, 90_000),
      extraBody,
    },
  };
}

/** Errors that make further requests pointless this run (bad key, unknown model, daily quota). */
export class FatalLlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FatalLlmError";
  }
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class LlmClient {
  private lastRequestAt = 0;
  private jsonMode = true;
  requests = 0;

  constructor(
    readonly config: LlmConfig,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async pace() {
    const wait = this.lastRequestAt + this.config.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }

  async chatJson<T>(messages: ChatMessage[], maxTokens = 3000): Promise<T> {
    const { baseUrl, apiKey, model, timeoutMs, extraBody } = this.config;
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 4; attempt++) {
      await this.pace();
      this.requests++;
      let res: Response;
      try {
        res = await this.fetchImpl(`${baseUrl}/chat/completions`, {
          method: "POST",
          signal: AbortSignal.timeout(timeoutMs),
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
        lastError = new Error(`请求失败：${(err as Error).message}`);
        await sleep(2000 * (attempt + 1));
        continue;
      }
      const text = await res.text();
      const detail = text.slice(0, 200).replace(/\s+/g, " ").trim();
      if (res.ok) {
        let body: { choices?: { message?: { content?: string } }[] };
        try {
          body = JSON.parse(text);
        } catch {
          throw new FatalLlmError(`接口返回的不是 JSON（${detail || "空响应"}），请检查 LLM_BASE_URL`);
        }
        try {
          return parseJsonContent<T>(body.choices?.[0]?.message?.content ?? "");
        } catch (err) {
          lastError = new Error(`无法解析模型输出：${(err as Error).message}`);
          continue;
        }
      }
      if (res.status === 400 && this.jsonMode && /response_format|json/i.test(text)) {
        this.jsonMode = false;
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new FatalLlmError(`鉴权失败（HTTP ${res.status}）：${detail}`);
      if (res.status === 404) throw new FatalLlmError(`模型或接口不存在（HTTP 404）：${detail}`);
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after") ?? NaN);
        if (Number.isFinite(retryAfter) && retryAfter > 90) throw new FatalLlmError(`已达到调用上限，约 ${Math.ceil(retryAfter / 60)} 分钟后恢复`);
        lastError = new Error(`触发限流（HTTP 429）：${detail}`);
        await sleep((Number.isFinite(retryAfter) ? retryAfter : 10 * (attempt + 1)) * 1000);
        continue;
      }
      if (res.status >= 500) {
        lastError = new Error(`服务端错误（HTTP ${res.status}）`);
        await sleep(3000 * (attempt + 1));
        continue;
      }
      throw new Error(`HTTP ${res.status}：${detail}`);
    }
    throw lastError ?? new Error("请求失败");
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

const SUMMARY_SYSTEM = `你是一名 AI 行业资讯编辑，读者是只看中文的用户。输入是一组 JSON 资讯，逐条处理：
1. title：lang 为 en 的条目写中文标题，不超过 30 个汉字，准确克制，不夸张；模型名、产品名、公司名、仓库名等专有名词保留英文原文（如 GPT-5、Claude、Seedance、owner/repo）。lang 为 zh 的条目 title 输出空字符串。
2. summary：一句话中文摘要，不超过 60 个汉字，说明发生了什么、为什么值得关注。只依据给出的标题和摘要，不得编造数字或细节；信息不足时概括标题即可。
3. category：从 ${CATEGORY_GUIDE} 中选一个 id。
只输出 JSON：{"items":[{"id":"...","title":"...","summary":"...","category":"..."}]}，id 与输入一致，每条都要输出。`;

interface SummaryResult {
  items?: { id?: string; title?: string; summary?: string; category?: string }[];
}

export interface SummarizeOutcome {
  summarized: number;
  failed: number;
  fatal?: string;
  error?: string;
}

/** Fills `item.ai` in place, batching items to stay inside per-request token and daily request limits. */
export async function summarizeItems(
  client: LlmClient,
  items: NewsItem[],
  onBatch?: (done: number, total: number) => void,
): Promise<SummarizeOutcome> {
  const { batchSize, maxRequests, model } = client.config;
  const batches: NewsItem[][] = [];
  for (let i = 0; i < items.length && batches.length < maxRequests; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  const outcome: SummarizeOutcome = { summarized: 0, failed: 0 };
  for (const [index, batch] of batches.entries()) {
    onBatch?.(index, batches.length);
    const payload = batch.map((item) => ({
      id: item.id,
      lang: item.lang,
      source: item.sourceName,
      title: truncate(item.title, 200),
      excerpt: item.excerpt ? truncate(item.excerpt, 280) : "",
    }));
    try {
      const result = await client.chatJson<SummaryResult>([
        { role: "system", content: SUMMARY_SYSTEM },
        { role: "user", content: JSON.stringify({ items: payload }) },
      ]);
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
        const category = CATEGORY_IDS.includes(r?.category as CategoryId) ? (r!.category as CategoryId) : undefined;
        item.ai = {
          title: item.lang === "en" && r?.title?.trim() ? truncate(r.title.trim(), 40) : undefined,
          summary: truncate(summary, 90),
          category,
          model,
          at,
        };
        if (category && !item.categoryLocked) item.category = category;
        outcome.summarized++;
      }
    } catch (err) {
      outcome.failed += batch.length;
      // A fatal error says nothing about these items, so it must not use up their attempts.
      if (err instanceof FatalLlmError) {
        outcome.fatal = err.message;
        break;
      }
      for (const item of batch) item.aiAttempts = (item.aiAttempts ?? 0) + 1;
      outcome.error = (err as Error).message;
    }
  }
  onBatch?.(batches.length, batches.length);
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
    1500,
  );
  const points = (result.points ?? [])
    .filter((p) => p?.text?.trim())
    .slice(0, 5)
    .map((p) => ({ text: truncate(p.text!.trim(), 60), refs: (p.refs ?? []).map(String).filter((id) => ids.has(id)) }));
  if (!result.overview?.trim() || points.length === 0) throw new Error("模型未返回有效的要点");
  return { overview: truncate(result.overview.trim(), 80), points };
}
