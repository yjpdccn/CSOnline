import { describe, expect, it } from "vitest";
import { applyClusters } from "@/lib/pipeline/cluster";
import { buildFallbackDigest, followsRanking, rankLatestPeriod } from "@/lib/pipeline/digest";
import { importanceParts, storyWeight } from "@/lib/pipeline/importance";
import { periodStart, rankStories, recency, type Rankable } from "@/lib/rank";
import { toClientItem } from "@/lib/view";
import type { NewsItem, SourceGroup } from "@/lib/types";

const NOW = Date.parse("2026-10-29T08:53:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

const GROUPS: Record<string, SourceGroup> = {
  deepmind: "official",
  openai: "official",
  nvidia: "official",
  hackernews: "community",
  "hf-papers": "community",
  "hf-models": "community",
  "reddit-localllama": "community",
  "github-trending": "community",
  "the-decoder": "media-en",
  "verge-ai": "media-en",
  "techcrunch-ai": "media-en",
  qbitai: "media-zh",
  "36kr-ai": "media-zh",
  jiqizhixin: "media-zh",
  geekpark: "media-zh",
};

let counter = 0;
function item(sourceId: string, title: string, hours: number, extra: Partial<NewsItem> = {}): NewsItem {
  const id = `r${++counter}`;
  return {
    id,
    key: `url:example.com/${id}`,
    title,
    url: `https://example.com/${sourceId}/${id}`,
    lang: /[\u4e00-\u9fff]/.test(title) ? "zh" : "en",
    sourceId,
    sourceName: sourceId,
    sourceGroup: GROUPS[sourceId] ?? "media-en",
    publishedAt: hoursAgo(hours),
    firstSeenAt: hoursAgo(hours),
    day: "2026-10-29",
    category: "industry",
    score: 20,
    ...extra,
  };
}

const rankable = (sourceId: string, weight: number, hours: number, firstHours?: number): Rankable & { id: string } => ({
  id: `${sourceId}-${weight}-${hours}`,
  sourceId,
  weight,
  publishedAt: hoursAgo(hours),
  firstAt: firstHours === undefined ? undefined : hoursAgo(firstHours),
});

describe("rankStories", () => {
  it("decays with the age of the story's first report", () => {
    expect(recency(24)).toBeCloseTo(0.5);
    const fresh = rankable("qbitai", 30, 1);
    const old = rankable("jiqizhixin", 30, 20);
    const lateReportOfOldStory = rankable("36kr-ai", 30, 1, 40);
    expect(rankStories([lateReportOfOldStory, old, fresh], NOW)).toEqual([fresh, old, lateReportOfOldStory]);
  });

  it("keeps noisy listings from filling the top", () => {
    const papers = [1, 2, 3, 4].map((h) => rankable("hf-papers", 30, h));
    const news = [
      rankable("qbitai", 20, 2),
      rankable("verge-ai", 20, 2),
      rankable("techcrunch-ai", 19, 2),
    ];
    const top = rankStories([...papers, ...news], NOW).slice(0, 5);
    expect(top[0]).toBe(papers[0]);
    expect(top.filter((r) => r.sourceId === "hf-papers").length).toBeLessThanOrEqual(2);
  });

  it("uses a 48-hour period when the last 24 hours are too quiet", () => {
    const busy = [1, 2, 3, 4, 5].map((h) => ({ publishedAt: hoursAgo(h) }));
    expect(periodStart(busy, NOW)).toBe(NOW - 24 * 3_600_000);
    expect(periodStart(busy.slice(0, 3), NOW)).toBe(NOW - 48 * 3_600_000);
  });
});

describe("importance", () => {
  it("rewards coverage, engagement, official launches and big labs", () => {
    const launch = item("deepmind", "Gemini 4 Carbon: Our next frontier model", 8, {
      category: "model",
      alsoOn: [{ sourceId: "hackernews", sourceName: "Hacker News", url: "https://news.ycombinator.com/item?id=1" }],
      metrics: { points: 833, comments: 695 },
    });
    const reports = [
      item("the-decoder", "Google Deepmind releases Gemini 4 Carbon just two weeks after Argon", 6),
      item("qbitai", "刚刚，Gemini 4 Carbon全面超越Opus 5.5！首发Token半价", 1),
      item("jiqizhixin", "刚刚，谷歌发布最强模型Gemini 4 Carbon！荣登榜首", 1),
    ];
    applyClusters([launch, ...reports]);
    const parts = importanceParts(launch);
    expect(parts).toMatchObject({ authority: 22, release: 14, company: 6, engagement: 22 });
    expect(parts.coverage).toBeGreaterThan(30);

    const single = item("techcrunch-ai", "Bank of America asks customers not to share passwords with AI assistants", 2);
    const modelPage = item("hf-models", "someone/tiny-model-gguf", 2, { metrics: { likes: 40 } });
    expect(storyWeight(launch)).toBeGreaterThan(3 * storyWeight(single));
    expect(storyWeight(single)).toBeGreaterThan(storyWeight(modelPage));
  });

  it("separates major from minor releases and discounts roundups", () => {
    const big = item("36kr-ai", "腾讯混元Hy4 、Hy4 flash即将发布，首次引入视觉理解能力", 2);
    const small = item("jiqizhixin", "X-Era AI拓元智慧开源原生4D世界动作模型E0.5", 2);
    expect(importanceParts(big).release).toBe(14);
    expect(importanceParts(small).release).toBe(6);
    const roundup = item("geekpark", "苹果发触屏笔记本；DeepSeek V5 模型代码现身；宇树首发财报｜极客早知道", 2);
    const plain = item("geekpark", "DeepSeek V5 模型代码现身", 2);
    expect(storyWeight(roundup)).toBeLessThan(storyWeight(plain));
  });

  it("treats a discussion of an official page like the lab's own post", () => {
    const viaHn = item("hackernews", "Early progress on accelerating drug development with Claude", 3, {
      url: "https://www.anthropic.com/research/early-progress-drug-development",
    });
    const plainHn = item("hackernews", "Brown student maps the hidden global labor powering AI", 3);
    expect(importanceParts(viaHn).authority).toBe(20);
    expect(importanceParts(plainHn).authority).toBe(10);
  });
});

describe("keeping an earlier AI 今日要点", () => {
  it("only while the stories it cites still top the ranking", () => {
    const launch = item("deepmind", "Gemini 4 Carbon: Our next frontier model", 8, { category: "model", metrics: { points: 800 } });
    const report = item("qbitai", "刚刚，Gemini 4 Carbon全面超越Opus 5.5！首发Token半价", 2);
    const fillerTitles = [
      "OpenAI expands Codex to enterprise teams",
      "Anthropic opens Claude Duet to all users",
      "Google ships agent mode in Android Studio",
      "Meta tests Muse in Singapore",
      "Microsoft hits record Azure revenue",
      "NVIDIA unveils RTX Spark laptops",
      "Apple delays its Siri overhaul",
      "Amazon cuts its Alexa team",
      "DeepSeek V5 code spotted in a repository",
      "阿里云大模型市场份额达到46.6%",
      "腾讯推出跨应用 AI 协同体系",
      "字节豆包上线电脑操作技能",
      "百度文心上线超长文档解析",
      "华为发布新一代昇腾芯片",
    ];
    const rotation = ["techcrunch-ai", "verge-ai", "the-decoder", "qbitai", "jiqizhixin", "36kr-ai"];
    const filler = fillerTitles.map((title, i) => item(rotation[i % rotation.length], title, 3 + i / 10));
    const minor = item("geekpark", "AI 漫剧越做越快，赚钱却没那么容易了", 20);
    const items = [launch, report, ...filler, minor];
    applyClusters(items);
    const now = new Date(NOW);
    expect(followsRanking({ points: [{ text: "Gemini", refs: [report.id] }] }, items, now)).toBe(true);
    expect(followsRanking({ points: [{ text: "Gemini", refs: [launch.id] }, { text: "漫剧", refs: [minor.id] }] }, items, now)).toBe(false);
  });
});

describe("今日要点 and the page share one ranking", () => {
  it("puts the digest's points at the top of the page's order", () => {
    const items = [
      item("deepmind", "Gemini 4 Carbon: Our next frontier model", 8, { category: "model", metrics: { points: 800 } }),
      item("the-decoder", "Google Deepmind releases Gemini 4 Carbon just two weeks after Argon", 6),
      item("nvidia", "NVIDIA Cosmos opens new tools to train world models", 5),
      item("hackernews", "Claude Code regularly sends each background agent’s transcript to its model", 3, { metrics: { points: 600, comments: 300 } }),
      item("hf-papers", "DTCA: Denoising Token Credit Assignment", 4, { metrics: { upvotes: 80 } }),
      item("hf-papers", "Efficient Streaming Audio-Visual Target Speaker Extraction", 4, { metrics: { upvotes: 70 } }),
      item("hf-models", "someone/tiny-model-gguf", 2, { metrics: { likes: 900 } }),
      item("github-trending", "obra/superpowers", 2, { metrics: { stars: 5000, starsToday: 900 } }),
      item("qbitai", "0营收估值200亿美元，具身版OpenAI又融10亿美元", 7),
      item("36kr-ai", "估值逼近200亿美元，资本看中了Physical Intelligence什么？", 4),
      item("techcrunch-ai", "Chrome’s AI-powered Autofill can now dig through your Gmail to fill out forms", 9),
      item("36kr-ai", "腾讯混元Hy4 、Hy4 flash即将发布，首次引入视觉理解能力", 6),
      item("geekpark", "AI 漫剧越做越快，赚钱却没那么容易了", 30),
    ];
    applyClusters(items);
    const cards = items.filter((i) => !i.dupOf);
    const latest = rankLatestPeriod(cards, new Date(NOW));
    const digest = buildFallbackDigest(latest);

    const clientCards = cards.map(toClientItem).filter((c) => Date.parse(c.publishedAt) >= periodStart(cards, NOW) && c.sourceId !== "github-trending");
    const pageTop = rankStories(clientCards, NOW).slice(0, 5).map((c) => c.id);
    expect(digest.points.map((p) => p.refs[0])).toEqual(pageTop);
    expect(pageTop[0]).toBe(items[0].id);
    expect(digest.points.map((p) => p.refs[0])).not.toContain(items[7].id);
    expect(latest.hours).toBe(24);
    expect(latest.period.map((i) => i.id)).not.toContain(items.at(-1)!.id);
  });
});
