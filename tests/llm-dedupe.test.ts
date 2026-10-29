import { describe, expect, it, vi } from "vitest";
import { applyClusters, clusterItems, pairKey } from "@/lib/pipeline/cluster";
import { LlmClient, type LlmConfig } from "@/lib/pipeline/llm";
import { findSameEventPairs } from "@/lib/pipeline/llm-dedupe";
import type { NewsItem } from "@/lib/types";

const config: LlmConfig = {
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

const now = new Date("2026-10-28T20:00:00Z");

function item(id: string, sourceId: string, title: string, publishedAt: string): NewsItem {
  return {
    id,
    key: `url:example.com/${id}`,
    title,
    url: `https://example.com/${id}`,
    lang: /[\u4e00-\u9fff]/.test(title) ? "zh" : "en",
    sourceId,
    sourceName: sourceId,
    sourceGroup: sourceId === "infoq-cn" ? "media-zh" : "media-en",
    publishedAt,
    firstSeenAt: publishedAt,
    day: publishedAt.slice(0, 10),
    category: "agent",
    score: 20,
  };
}

const hackZh = item("zh", "infoq-cn", "Anthropic 内部系统被 AI Agent 12 小时攻破！会议记录、员工薪酬、内部模型讨论遭访问", "2026-10-28T09:54:00Z");
const hackEn = item("en", "the-decoder", "AI agents hacked Anthropic, maker of arguably the most capable AI models for cyberdefense", "2026-10-28T10:56:00Z");
const other = item("other", "techcrunch-ai", "Bank of America kindly asks that you don’t share your banking password with your AI assistant", "2026-10-27T21:44:00Z");

function reply(content: unknown) {
  return vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("findSameEventPairs", () => {
  it("turns model groups into pairs that the clustering then honours", async () => {
    const items = [hackZh, hackEn, other];
    const fetchMock = reply({ groups: [["zh", "en"], ["other", "unknown-id"]] });
    const client = new LlmClient(config, fetchMock as unknown as typeof fetch);
    const outcome = await findSameEventPairs(client, clusterItems(items), now);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(outcome.pairs).toEqual([pairKey("zh", "en")]);
    applyClusters(items, new Set(outcome.pairs));
    expect([hackZh.dupOf, hackEn.dupOf].filter(Boolean)).toHaveLength(1);
    expect(other.dupOf).toBeUndefined();
  });

  it("fails soft and skips the request when there is nothing to compare", async () => {
    const failing = vi.fn(async () => new Response("bad gateway", { status: 502 }));
    const client = new LlmClient(config, failing as unknown as typeof fetch);
    const old = item("old", "verge-ai", "Old story", "2026-10-20T00:00:00Z");
    expect(await findSameEventPairs(client, clusterItems([old]), now)).toEqual({ pairs: [] });
    expect(failing).not.toHaveBeenCalled();

    const auth = vi.fn(async () => new Response(JSON.stringify({ error: "bad key" }), { status: 401 }));
    const outcome = await findSameEventPairs(new LlmClient(config, auth as unknown as typeof fetch), clusterItems([hackZh, hackEn]), now);
    expect(outcome.pairs).toEqual([]);
    expect(outcome.fatal).toContain("鉴权失败");
  });
});
