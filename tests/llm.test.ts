import { describe, expect, it, vi } from "vitest";
import { getLlmConfig, LlmClient, parseJsonContent, summarizeItems, type LlmConfig } from "@/lib/pipeline/llm";
import type { NewsItem } from "@/lib/types";

const baseConfig: LlmConfig = {
  apiKey: "test",
  baseUrl: "https://llm.test/v1",
  model: "test-model",
  provider: "test",
  batchSize: 12,
  maxRequests: 20,
  minIntervalMs: 0,
  timeoutMs: 5000,
  extraBody: {},
};

function makeItems(n: number, lang: "en" | "zh" = "en"): NewsItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `id${i}`,
    key: `url:example.com/${i}`,
    title: `Item ${i}`,
    url: `https://example.com/${i}`,
    lang,
    sourceId: "s",
    sourceName: "S",
    sourceGroup: "official",
    publishedAt: "2026-10-29T00:00:00.000Z",
    firstSeenAt: "2026-10-29T00:00:00.000Z",
    day: "2026-10-29",
    category: "industry",
    score: 1,
  }));
}

const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/** Echoes every requested id back with a Chinese title and summary. */
function echoFetch() {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const { items } = JSON.parse(body.messages[1].content) as { items: { id: string }[] };
    const content = JSON.stringify({
      items: items.map((i) => ({ id: i.id, title: `中文标题 ${i.id}`, summary: `一句话摘要 ${i.id}`, category: "agent" })),
    });
    return jsonResponse({ choices: [{ message: { content: "```json\n" + content + "\n```" } }] });
  });
}

describe("getLlmConfig", () => {
  it("defaults to the free GLM model when only LLM_API_KEY is set", () => {
    const { config } = getLlmConfig(env({ LLM_API_KEY: "k" }));
    expect(config?.baseUrl).toBe("https://open.bigmodel.cn/api/paas/v4");
    expect(config?.model).toBe("glm-4.7-flash");
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

describe("summarizeItems", () => {
  it("batches requests and fills Chinese titles only for English items", async () => {
    const fetchMock = echoFetch();
    const client = new LlmClient(baseConfig, fetchMock as unknown as typeof fetch);
    const items = [...makeItems(20, "en"), ...makeItems(5, "zh").map((i) => ({ ...i, id: `zh${i.id}` }))];
    items[0].categoryLocked = true;
    const outcome = await summarizeItems(client, items);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(outcome).toMatchObject({ summarized: 25, failed: 0 });
    expect(items[1].ai).toMatchObject({ title: "中文标题 id1", summary: "一句话摘要 id1", model: "test-model" });
    expect(items[1].category).toBe("agent");
    expect(items[0].category).toBe("industry");
    expect(items[24].ai?.title).toBeUndefined();
  });

  it("respects the per-run request cap", async () => {
    const fetchMock = echoFetch();
    const client = new LlmClient({ ...baseConfig, batchSize: 5, maxRequests: 2 }, fetchMock as unknown as typeof fetch);
    const outcome = await summarizeItems(client, makeItems(30));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(outcome.summarized).toBe(10);
  });

  it("stops after an authentication error", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "bad key" }, 401));
    const client = new LlmClient(baseConfig, fetchMock as unknown as typeof fetch);
    const items = makeItems(30);
    const outcome = await summarizeItems(client, items);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(outcome.fatal).toContain("鉴权失败");
    expect(items[0].aiAttempts).toBeUndefined();
    expect(items[29].ai).toBeUndefined();
  });

  it("stops at once when the endpoint does not answer with JSON", async () => {
    const fetchMock = vi.fn(async () => new Response("OK\r\n", { status: 200, headers: { "content-type": "text/plain" } }));
    const client = new LlmClient(baseConfig, fetchMock as unknown as typeof fetch);
    const items = makeItems(30);
    const outcome = await summarizeItems(client, items);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(outcome.fatal).toContain("不是 JSON");
    expect(items[0].aiAttempts).toBeUndefined();
  });

  it("treats a long Retry-After as an exhausted daily quota", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "rate limit" }, 429, { "retry-after": "3600" }));
    const client = new LlmClient(baseConfig, fetchMock as unknown as typeof fetch);
    const outcome = await summarizeItems(client, makeItems(3));
    expect(outcome.fatal).toContain("调用上限");
  });

  it("gives up for the run when rate limiting outlasts the retries", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: { code: "1302", message: "并发数过高" } }, 429, { "retry-after": "0" }));
    const client = new LlmClient(baseConfig, fetchMock as unknown as typeof fetch);
    const items = makeItems(30);
    const outcome = await summarizeItems(client, items);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(outcome.fatal).toContain("1302");
    expect(items[0].aiAttempts).toBeUndefined();
  });

  it("recovers when a rate limit clears on retry", async () => {
    const echo = echoFetch();
    let calls = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
      ++calls === 1 ? jsonResponse({ error: "busy" }, 429, { "retry-after": "0" }) : echo(url, init),
    );
    const client = new LlmClient(baseConfig, fetchMock as unknown as typeof fetch);
    const outcome = await summarizeItems(client, makeItems(3));
    expect(outcome).toMatchObject({ summarized: 3, failed: 0 });
    expect(outcome.fatal).toBeUndefined();
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
    const client = new LlmClient(baseConfig, fetchMock as unknown as typeof fetch);
    const outcome = await summarizeItems(client, makeItems(2));
    expect(outcome.summarized).toBe(2);
  });
});
