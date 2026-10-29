import { describe, expect, it } from "vitest";
import { compareItems } from "@/lib/pipeline/cluster";
import { Deduper, mergeDuplicate } from "@/lib/pipeline/dedupe";
import { keyFromUrl, normalizeUrl } from "@/lib/pipeline/url";
import { titleFingerprint, titleSimilarity } from "@/lib/pipeline/text";
import type { NewsItem } from "@/lib/types";

describe("keyFromUrl", () => {
  it("collapses GitHub repo URLs", () => {
    expect(keyFromUrl("https://github.com/Obra/Superpowers")).toBe("gh:obra/superpowers");
    expect(keyFromUrl("https://github.com/obra/superpowers/tree/main/docs")).toBe("gh:obra/superpowers");
    expect(keyFromUrl("https://github.com/trending/python")).not.toMatch(/^gh:/);
  });

  it("maps arXiv and Hugging Face paper pages to one key", () => {
    expect(keyFromUrl("https://arxiv.org/abs/2610.32749v2")).toBe("arxiv:2610.32749");
    expect(keyFromUrl("https://arxiv.org/pdf/2610.32749")).toBe("arxiv:2610.32749");
    expect(keyFromUrl("https://huggingface.co/papers/2610.32749")).toBe("arxiv:2610.32749");
  });

  it("strips tracking parameters and trailing slashes", () => {
    expect(normalizeUrl("https://www.Example.com/post/?utm_source=rss&id=3#top")).toBe("example.com/post?id=3");
    expect(keyFromUrl("https://openai.com/index/gpt-6/?utm_medium=feed")).toBe(keyFromUrl("https://openai.com/index/gpt-6"));
  });
});

function item(partial: Partial<NewsItem>): NewsItem {
  return {
    id: partial.key ?? "x",
    key: "url:example.com",
    title: "Title",
    url: "https://example.com",
    lang: "zh",
    sourceId: "a",
    sourceName: "A",
    sourceGroup: "media-zh",
    publishedAt: "2026-10-29T02:00:00.000Z",
    firstSeenAt: "2026-10-29T02:00:00.000Z",
    day: "2026-10-29",
    category: "industry",
    score: 10,
    ...partial,
  };
}

describe("title similarity", () => {
  it("scores near-identical Chinese titles highly", () => {
    const a = titleFingerprint("豆包工作能力升级：操作电脑可录制成技能，锁屏后也能继续任务");
    const b = titleFingerprint("豆包工作能力升级:操作电脑可录制成技能,锁屏后也能继续任务！");
    expect(titleSimilarity(a, b)).toBeGreaterThan(0.95);
    expect(titleSimilarity(a, titleFingerprint("谷歌发布 Gemini 4 Carbon"))).toBeLessThan(0.3);
  });
});

describe("near-identical headlines", () => {
  it("merge reposts across sources and test reposts within one source", () => {
    const stored = item({ id: "a", key: "url:a/1", title: "清华27岁助理教授杀入AI自进化赛道！首个35B模型刚刚亮相", sourceId: "jiqizhixin" });
    const otherSource = item({ id: "b", key: "url:b/1", title: "清华27岁助理教授杀入AI自进化赛道，首个35B模型刚刚亮相", sourceId: "36kr-ai" });
    const testPost = item({ id: "c", key: "url:a/2", title: `【图片中转测试，未发布】${stored.title}`, sourceId: "jiqizhixin" });
    expect(compareItems(stored, otherSource).same).toBe(true);
    expect(compareItems(stored, testPost).same).toBe(true);
  });

  it("never merge different model versions", () => {
    const a = item({ id: "a", title: "GLM-5.3 正式发布，编程能力大幅提升", sourceId: "jiqizhixin" });
    const b = item({ id: "b", title: "GLM-5.5 正式发布，编程能力大幅提升", sourceId: "qbitai" });
    expect(compareItems(a, b).same).toBe(false);
  });
});

describe("Deduper", () => {
  it("finds stored items by key", () => {
    const stored = item({ key: "gh:obra/superpowers" });
    expect(new Deduper([stored]).findByKey("gh:obra/superpowers")).toBe(stored);
  });

  it("merges discussion links and engagement into the primary item", () => {
    const primary = item({ key: "url:openai.com/x", sourceId: "openai", sourceName: "OpenAI", sourceGroup: "official", score: 30 });
    const hn = item({
      key: "url:openai.com/x",
      sourceId: "hackernews",
      sourceName: "Hacker News",
      sourceGroup: "community",
      discussionUrl: "https://news.ycombinator.com/item?id=1",
      metrics: { points: 500, comments: 200 },
    });
    expect(mergeDuplicate(primary, hn)).toBe(true);
    expect(primary.alsoOn).toEqual([{ sourceId: "hackernews", sourceName: "Hacker News", url: "https://news.ycombinator.com/item?id=1" }]);
    expect(primary.metrics?.points).toBe(500);
    expect(primary.score).toBeGreaterThan(30);
    expect(mergeDuplicate(primary, hn)).toBe(false);
  });
});
