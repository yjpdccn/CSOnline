import { describe, expect, it, vi } from "vitest";
import {
  generateAiDigest,
  getLlmConfig,
  LlmClient,
  MAX_AI_ATTEMPTS,
  parseJsonContent,
  pendingSummaries,
  summarizeItems,
  summaryProgress,
  type LlmConfig,
} from "@/lib/pipeline/llm";
import type { NewsItem } from "@/lib/types";

const baseConfig: LlmConfig = {
  apiKey: "test",
  baseUrl: "https://llm.test/v1",
  model: "test-model",
  provider: "test",
  batchSize: 12,
  maxItems: 100,
  maxRequests: 20,
  minIntervalMs: 0,
  timeoutMs: 60_000,
  budgetMs: 360_000,
  extraBody: {},
};

function makeItems(n: number, lang: "en" | "zh" = "en", day = "2026-10-29"): NewsItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `id${i}`,
    key: `url:example.com/${i}`,
    title: `Item ${i}`,
    url: `https://example.com/${i}`,
    lang,
    sourceId: "s",
    sourceName: "S",
    sourceGroup: "official",
    publishedAt: `${day}T00:00:00.000Z`,
    firstSeenAt: `${day}T00:00:00.000Z`,
    day,
    category: "industry",
    score: 1,
  }));
}

const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const zhipuError = (status: number, code: string, message: string, headers: Record<string, string> = {}) =>
  jsonResponse({ error: { code, message } }, status, headers);

function requestedIds(init?: RequestInit): string[] {
  const body = JSON.parse(String(init?.body));
  return (JSON.parse(body.messages[1].content) as { items: { id: string }[] }).items.map((i) => i.id);
}

/** Echoes every requested id back with a Chinese title and summary, except the ids in `skip`. */
function echoFetch(skip: string[] = []) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const items = requestedIds(init)
      .filter((id) => !skip.includes(id))
      .map((id) => ({ id, zh_title: `中文标题 ${id}`, summary: `一句话摘要 ${id}`, category: "agent" }));
    return jsonResponse({ choices: [{ message: { content: "```json\n" + JSON.stringify({ items }) + "\n```" } }] });
  });
}

/** Sleeping advances a fake clock instantly and records each pause. */
function fakeTime() {
  let t = Date.parse("2026-10-29T08:00:00Z");
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
  };
}

function setup(fetchMock: unknown, config: Partial<LlmConfig> = {}) {
  const time = fakeTime();
  const client = new LlmClient({ ...baseConfig, ...config }, fetchMock as typeof fetch, { sleep: time.sleep, now: time.now });
  return { client, time, deadline: time.now() + 3_600_000 };
}

describe("getLlmConfig", () => {
  it("defaults to the free GLM model with bigger, paced batches and a per-run budget", () => {
    const { config } = getLlmConfig(env({ LLM_API_KEY: "k" }));
    expect(config).toMatchObject({
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      model: "glm-4.7-flash",
      batchSize: 20,
      maxItems: 100,
      minIntervalMs: 3000,
      budgetMs: 360_000,
    });
  });

  it("no longer falls back to GITHUB_TOKEN and explains that GitHub Models is retired", () => {
    expect(getLlmConfig(env({ GITHUB_TOKEN: "ghs_x" })).config).toBeNull();
    const retired = getLlmConfig(env({ LLM_API_KEY: "k", LLM_BASE_URL: "https://models.github.ai/inference" }));
    expect(retired.config).toBeNull();
    expect(retired.reason).toContain("停止服务");
  });

  it("knows the free GLM model and disables thinking", () => {
    const { config } = getLlmConfig(env({ LLM_API_KEY: "k", LLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4" }));
    expect(config?.model).toBe("glm-4.7-flash");
    expect(config?.extraBody).toEqual({ thinking: { type: "disabled" } });
  });

  it("reports why summaries are off", () => {
    expect(getLlmConfig(env({})).reason).toContain("LLM_API_KEY");
    expect(getLlmConfig(env({ LLM_API_KEY: "k", LLM_BASE_URL: "https://example.com/v1" })).reason).toContain("LLM_MODEL");
  });
});

describe("parseJsonContent", () => {
  it("handles fenced and prefixed output", () => {
    expect(parseJsonContent<{ a: number }>("```json\n{\"a\":1}\n```").a).toBe(1);
    expect(parseJsonContent<{ a: number }>("好的：{\"a\":2}").a).toBe(2);
  });
});

describe("pendingSummaries", () => {
  it("puts untranslated English first, then the newest day and highest score, and skips old or settled items", () => {
    const now = new Date("2026-10-29T08:00:00Z");
    const mk = (id: string, lang: "en" | "zh", day: string, score: number, extra: Partial<NewsItem> = {}) => ({
      ...makeItems(1, lang, day)[0],
      id,
      score,
      ...extra,
    });
    const items = [
      mk("en27", "en", "2026-10-27", 5),
      mk("en29low", "en", "2026-10-29", 1),
      mk("zh29", "zh", "2026-10-29", 9),
      mk("en29high", "en", "2026-10-29", 3),
      mk("old", "en", "2026-10-24", 9),
      mk("exhausted", "en", "2026-10-29", 9, { aiAttempts: MAX_AI_ATTEMPTS }),
      mk("done", "en", "2026-10-29", 9, { ai: { title: "中文标题", summary: "已有", model: "m", at: "x" } }),
      mk("echoed", "en", "2026-10-28", 9, { ai: { title: "English headline", summary: "已有摘要", model: "m", at: "x" } }),
      mk("merged", "en", "2026-10-29", 9, { dupOf: "en29high" }),
    ];
    expect(pendingSummaries(items, now).map((i) => i.id)).toEqual(["en29high", "en29low", "echoed", "en27", "zh29"]);
    expect(summaryProgress(items, now)).toEqual({ done: 1, pending: 5 });
  });
});

describe("summarizeItems", () => {
  it("batches requests and fills Chinese titles only for English items", async () => {
    const fetchMock = echoFetch();
    const { client, deadline } = setup(fetchMock);
    const items = [...makeItems(20, "en"), ...makeItems(5, "zh").map((i) => ({ ...i, id: `zh${i.id}` }))];
    items[0].categoryLocked = true;
    const outcome = await summarizeItems(client, items, { deadline });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(outcome).toMatchObject({ summarized: 25, failed: 0 });
    expect(items[1].ai).toMatchObject({ title: "中文标题 id1", summary: "一句话摘要 id1", model: "test-model" });
    expect(items[1].category).toBe("agent");
    expect(items[0].category).toBe("industry");
    expect(items[24].ai?.title).toBeUndefined();
  });

  it("spaces requests out and sends one at a time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const echo = echoFetch();
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      maxInFlight = Math.max(maxInFlight, ++inFlight);
      await Promise.resolve();
      inFlight--;
      return echo(url, init);
    });
    const { client, time, deadline } = setup(fetchMock, { batchSize: 5, minIntervalMs: 3000 });
    await summarizeItems(client, makeItems(15), { deadline });
    expect(maxInFlight).toBe(1);
    expect(time.sleeps).toEqual([3000, 3000]);
  });

  it("caps the items per run so the rest of the backlog carries over untouched", async () => {
    const fetchMock = echoFetch();
    const { client, deadline } = setup(fetchMock, { batchSize: 10, maxItems: 20 });
    const items = makeItems(35);
    const outcome = await summarizeItems(client, items, { deadline });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(outcome.summarized).toBe(20);
    expect(outcome.stop).toBeUndefined();
    expect(items.slice(20).every((i) => !i.ai && i.aiAttempts === undefined)).toBe(true);
  });

  it("keeps the summary but retries the title later when the model echoes the English headline", async () => {
    const answer = (items: object[]) => jsonResponse({ choices: [{ message: { content: JSON.stringify({ items }) } }] });
    const fetchMock = vi.fn(async () => answer([{ id: "id0", zh_title: "Item 0 in English", summary: "中文摘要", category: "agent" }]));
    const { client, deadline } = setup(fetchMock);
    const items = makeItems(1);
    const outcome = await summarizeItems(client, items, { deadline });
    expect(outcome.summarized).toBe(1);
    expect(items[0].ai).toMatchObject({ summary: "中文摘要" });
    expect(items[0].ai?.title).toBeUndefined();
    expect(items[0].aiAttempts).toBe(1);
    expect(pendingSummaries(items, new Date("2026-10-29T08:00:00Z"))).toHaveLength(1);

    fetchMock.mockImplementation(async () => answer([{ id: "id0", title: "旧字段里的中文标题", summary: "新的中文摘要", category: "agent" }]));
    await summarizeItems(client, items, { deadline });
    expect(items[0].ai).toMatchObject({ title: "旧字段里的中文标题", summary: "新的中文摘要" });
    expect(pendingSummaries(items, new Date("2026-10-29T08:00:00Z"))).toHaveLength(0);
  });

  it("leaves an existing summary alone when a retry still has no Chinese title", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: JSON.stringify({ items: [{ id: "id0", zh_title: "Still English", summary: "另一个摘要" }] }) } }] }),
    );
    const { client, deadline } = setup(fetchMock);
    const items = makeItems(1).map((i) => ({ ...i, ai: { title: "Item 0", summary: "原来的摘要", model: "m", at: "x" } }));
    const outcome = await summarizeItems(client, items, { deadline });
    expect(outcome).toMatchObject({ summarized: 0, failed: 1 });
    expect(items[0].ai?.summary).toBe("原来的摘要");
    expect(items[0].aiAttempts).toBe(1);
  });

  it("stops at once on an invalid key without using up attempts", async () => {
    const fetchMock = vi.fn(async () => zhipuError(401, "401", "令牌已过期或验证不正确"));
    const { client, deadline } = setup(fetchMock);
    const items = makeItems(30);
    const outcome = await summarizeItems(client, items, { deadline });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(outcome.stop).toMatchObject({ kind: "config", detail: "HTTP 401 令牌已过期或验证不正确" });
    expect(outcome.stop?.message).toContain("LLM_API_KEY");
    expect(items.every((i) => i.aiAttempts === undefined)).toBe(true);
  });

  it("backs off longer on 1305 overload, then leaves the backlog for the next run", async () => {
    const fetchMock = vi.fn(async () => zhipuError(429, "1305", "该模型当前访问量过大，请您稍后再试"));
    const { client, time, deadline } = setup(fetchMock);
    const items = makeItems(30);
    const outcome = await summarizeItems(client, items, { deadline });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(time.sleeps).toHaveLength(2);
    expect(time.sleeps[0]).toBeGreaterThanOrEqual(20_000);
    expect(time.sleeps[1]).toBeGreaterThanOrEqual(40_000);
    expect(outcome.stop).toMatchObject({ kind: "busy" });
    expect(outcome.stop?.detail).toBe("HTTP 429 · 1305 该模型当前访问量过大，请您稍后再试");
    expect(outcome.summarized).toBe(0);
    expect(items.every((i) => i.aiAttempts === undefined)).toBe(true);
  });

  it("honors Retry-After", async () => {
    const echo = echoFetch();
    let calls = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
      ++calls === 1 ? zhipuError(429, "1302", "您的账户已达到速率限制", { "retry-after": "7" }) : echo(url, init),
    );
    const { client, time, deadline } = setup(fetchMock);
    const outcome = await summarizeItems(client, makeItems(3), { deadline });
    expect(time.sleeps).toEqual([7000]);
    expect(outcome).toMatchObject({ summarized: 3, failed: 0 });
  });

  it("recovers when a 1302 account rate limit clears", async () => {
    const echo = echoFetch();
    let calls = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
      ++calls === 1 ? zhipuError(429, "1302", "您的账户已达到速率限制") : echo(url, init),
    );
    const { client, time, deadline } = setup(fetchMock);
    const outcome = await summarizeItems(client, makeItems(3), { deadline });
    expect(time.sleeps[0]).toBeGreaterThanOrEqual(10_000);
    expect(time.sleeps[0]).toBeLessThanOrEqual(12_500);
    expect(outcome).toMatchObject({ summarized: 3, failed: 0 });
    expect(outcome.stop).toBeUndefined();
  });

  it("does not start a request it cannot finish before the deadline", async () => {
    const fetchMock = echoFetch();
    const { client, time } = setup(fetchMock);
    const outcome = await summarizeItems(client, makeItems(3), { deadline: time.now() + 10_000 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(outcome.stop?.kind).toBe("limit");
  });

  it("gives up for the run when the next backoff would pass the deadline", async () => {
    const fetchMock = vi.fn(async () => zhipuError(429, "1305", "该模型当前访问量过大，请您稍后再试"));
    const { client, time } = setup(fetchMock);
    const outcome = await summarizeItems(client, makeItems(3), { deadline: time.now() + 60_000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(outcome.stop?.kind).toBe("busy");
  });

  it("splits a batch the content filter refuses until the offending item is isolated", async () => {
    const echo = echoFetch();
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
      requestedIds(init).includes("id2") ? zhipuError(400, "1301", "系统检测到输入或生成内容可能包含不安全或敏感内容") : echo(url, init),
    );
    const { client, deadline } = setup(fetchMock);
    const items = makeItems(4);
    const outcome = await summarizeItems(client, items, { deadline });
    expect(outcome).toMatchObject({ summarized: 3, failed: 1 });
    expect(items[2].aiAttempts).toBe(MAX_AI_ATTEMPTS);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("treats a non-JSON 200 answer as a wrong endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response("OK\r\n", { status: 200, headers: { "content-type": "text/plain" } }));
    const { client, deadline } = setup(fetchMock);
    const outcome = await summarizeItems(client, makeItems(30), { deadline });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(outcome.stop).toMatchObject({ kind: "config" });
    expect(outcome.stop?.message).toContain("LLM_BASE_URL");
  });

  it("stops on an unpaid balance (1113) as a quota problem", async () => {
    const fetchMock = vi.fn(async () => zhipuError(429, "1113", "您的账户已欠费，请充值后重试"));
    const { client, deadline } = setup(fetchMock);
    const outcome = await summarizeItems(client, makeItems(3), { deadline });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(outcome.stop?.kind).toBe("quota");
  });

  it("treats a long Retry-After as a quota window", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "rate limit" }, 429, { "retry-after": "3600" }));
    const { client, deadline } = setup(fetchMock);
    const outcome = await summarizeItems(client, makeItems(3), { deadline });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(outcome.stop?.kind).toBe("quota");
  });

  it("charges an attempt only to items the model skipped", async () => {
    const { client, deadline } = setup(echoFetch(["id1"]));
    const items = makeItems(3);
    const outcome = await summarizeItems(client, items, { deadline });
    expect(outcome).toMatchObject({ summarized: 2, failed: 1 });
    expect(items[1].aiAttempts).toBe(1);
    expect(items[0].aiAttempts).toBeUndefined();
  });

  it("retries unparsable output, then charges the batch one attempt and moves on", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "抱歉，我无法完成" } }] }));
    const { client, deadline } = setup(fetchMock, { batchSize: 2 });
    const items = makeItems(4);
    const outcome = await summarizeItems(client, items, { deadline });
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(outcome.stop).toBeUndefined();
    expect(outcome.error).toContain("无法解析");
    expect(items.every((i) => i.aiAttempts === 1)).toBe(true);
  });

  it("retries without response_format when the provider rejects it", async () => {
    const echo = echoFetch();
    let first = true;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (first) {
        first = false;
        return jsonResponse({ error: { message: "response_format is not supported" } }, 400);
      }
      expect(JSON.parse(String(init?.body)).response_format).toBeUndefined();
      return echo(url, init);
    });
    const { client, deadline } = setup(fetchMock);
    const outcome = await summarizeItems(client, makeItems(2), { deadline });
    expect(outcome.summarized).toBe(2);
  });
});

describe("generateAiDigest", () => {
  it("keeps only references to the items it was given", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        choices: [{ message: { content: JSON.stringify({ overview: "今天的总览", points: [{ text: "要点一", refs: ["id0", "nope"] }] }) } }],
      }),
    );
    const { client, deadline } = setup(fetchMock);
    const digest = await generateAiDigest(client, makeItems(3), deadline);
    expect(digest).toEqual({ overview: "今天的总览", points: [{ text: "要点一", refs: ["id0"] }] });
  });
});
