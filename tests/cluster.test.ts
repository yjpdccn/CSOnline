import { describe, expect, it } from "vitest";
import { applyClusters, clusterItems, compareItems, pairKey } from "@/lib/pipeline/cluster";
import { buildFallbackDigest, rankLatestPeriod } from "@/lib/pipeline/digest";
import { visibleCount } from "@/lib/pipeline/store";
import { toClientItem } from "@/lib/view";
import type { NewsItem, SourceGroup } from "@/lib/types";

const GROUPS: Record<string, SourceGroup> = {
  deepmind: "official",
  "google-ai": "official",
  "google-dev": "official",
  "google-research": "official",
  openai: "official",
  anthropic: "official",
  hackernews: "community",
  "reddit-localllama": "community",
  "hf-models": "community",
  "github-new": "community",
  simonw: "blogger",
  "the-decoder": "media-en",
  "verge-ai": "media-en",
  "techcrunch-ai": "media-en",
  qbitai: "media-zh",
  "36kr-ai": "media-zh",
  "36kr-flash": "media-zh",
  jiqizhixin: "media-zh",
  geekpark: "media-zh",
  leiphone: "media-zh",
  "infoq-cn": "media-zh",
};

let counter = 0;
function item(sourceId: string, title: string, publishedAt: string, extra: Partial<NewsItem> = {}): NewsItem {
  const id = `i${++counter}`;
  return {
    id,
    key: `url:example.com/${id}`,
    title,
    url: `https://example.com/${sourceId}/${id}`,
    lang: /[\u4e00-\u9fff]/.test(title) ? "zh" : "en",
    sourceId,
    sourceName: sourceId,
    sourceGroup: GROUPS[sourceId] ?? "media-en",
    publishedAt,
    firstSeenAt: publishedAt,
    day: publishedAt.slice(0, 10),
    category: "model",
    score: 20,
    ...extra,
  };
}

const same = (a: NewsItem, b: NewsItem) => compareItems(a, b).same;

describe("Gemini 4 Carbon acceptance", () => {
  const official = item("deepmind", "Gemini 4 Carbon: Our next frontier model", "2026-10-29T01:00:00Z", {
    alsoOn: [{ sourceId: "hackernews", sourceName: "Hacker News", url: "https://news.ycombinator.com/item?id=50276792" }],
    metrics: { points: 900, comments: 400 },
    score: 70,
  });
  const reports = [
    item("google-ai", "5 things to know about Gemini 4 Carbon", "2026-10-29T01:00:00Z"),
    item("google-dev", "Start building with Gemini 4 Carbon in the Gemini API and Vertex AI", "2026-10-29T01:05:00Z"),
    item("google-research", "The research behind Gemini 4 Carbon's long-horizon agents", "2026-10-29T02:00:00Z"),
    item("hackernews", "Gemini 4 Carbon tops Artificial Analysis Intelligence Index", "2026-10-29T02:10:00Z", {
      url: "https://arstechnica.com/ai/2026/10/gemini-4-carbon",
    }),
    item("the-decoder", "Google Deepmind releases Gemini 4 Carbon just two weeks after Argon with gains across the board", "2026-10-29T03:17:00Z"),
    item("verge-ai", "Google launches Gemini 4 Carbon with a ‘significant leap’ in cybersecurity", "2026-10-29T04:03:00Z"),
    item("qbitai", "刚刚，Gemini 4 Carbon全面超越Opus 5.5！首发Token半价", "2026-10-29T08:03:00Z"),
    item("36kr-ai", "刚刚，Gemini 4 Carbon发布，谷歌重回世界第一", "2026-10-29T08:17:00Z"),
    item("36kr-ai", "Gemini 4 Carbon能给谷歌挽尊吗？", "2026-10-29T10:16:00Z"),
    item("jiqizhixin", "刚刚，谷歌发布最强模型Gemini 4 Carbon！荣登榜首", "2026-10-29T10:42:00Z"),
  ];
  const unrelated = [
    item("the-decoder", "Google opens Android development to third-party AI agents and unveils new Gemini APIs", "2026-10-29T00:59:00Z"),
    item("techcrunch-ai", "As AI agents reshape the web, Google opens Gemini and Search to more apps", "2026-10-29T01:00:00Z"),
    item("36kr-ai", "GTA 6还没来，但老外已经用谷歌新模型开上车了", "2026-10-29T11:01:00Z"),
    item("openai", "Introducing GPT-6.1 Terra", "2026-10-28T08:00:00Z"),
  ];

  it("collapses every report into one card led by the official post", () => {
    const clusters = clusterItems([...unrelated, ...reports, official]);
    const gemini = clusters.find((c) => c.primary === official || c.members.includes(official))!;
    expect(gemini.primary).toBe(official);
    expect(gemini.members).toHaveLength(reports.length);
    for (const u of unrelated) expect(clusters.find((c) => c.primary === u)?.members).toEqual([]);
  });

  it("shows the other reports as 也见于 and keeps them out of lists, counts and 今日要点", () => {
    const all = [official, ...reports, ...unrelated];
    applyClusters(all);
    expect(reports.every((r) => r.dupOf === official.id)).toBe(true);
    expect(visibleCount(all)).toBe(1 + unrelated.length);

    const card = toClientItem(official);
    const names = card.alsoOn!.map((a) => a.name);
    expect(names).toEqual(expect.arrayContaining(["google-ai", "google-dev", "google-research", "hackernews", "the-decoder", "verge-ai", "qbitai", "36kr-ai", "jiqizhixin", "Hacker News"]));
    expect(card.alsoOn!.find((a) => a.name === "jiqizhixin")?.title).toBe("刚刚，谷歌发布最强模型Gemini 4 Carbon！荣登榜首");
    expect(official.story).toMatchObject({ reports: 1 + 1 + reports.length, firstPublishedAt: "2026-10-29T01:00:00Z" });
    expect(official.story?.sources).toEqual(expect.arrayContaining(["deepmind", "hackernews", "google-ai", "jiqizhixin"]));

    const digest = buildFallbackDigest(rankLatestPeriod(all.filter((i) => !i.dupOf), new Date("2026-10-29T12:00:00Z")));
    expect(digest.points.filter((p) => p.text.includes("Gemini 4 Carbon"))).toHaveLength(1);
    expect(digest.points.flatMap((p) => p.refs)).not.toEqual(expect.arrayContaining(reports.map((r) => r.id)));
  });

  it("is stable when run again", () => {
    const all = [official, ...reports, ...unrelated];
    applyClusters(all);
    expect(applyClusters(all).changed).toEqual([]);
  });
});

describe("distinct stories stay apart", () => {
  it("different variants or versions of one model family", () => {
    const terra = item("openai", "Introducing GPT-6.1 Terra", "2026-10-26T00:00:00Z");
    const sol = item("openai", "GPT-6.1 Sol helps CodeRabbit strengthen security across complex codebases", "2026-10-26T13:45:00Z");
    const terraZh = item("qbitai", "GPT-6.1 Terra首批网友实测来了！1折价格获得Astra级电脑操作能力", "2026-10-27T08:27:00Z");
    expect(same(terra, sol)).toBe(false);
    expect(same(sol, terraZh)).toBe(false);
    expect(same(terra, terraZh)).toBe(true);
    const glm55 = item("leiphone", "GLM-5.5 要来了？唐杰最新论文，曝出智谱神秘模型", "2026-10-27T07:43:00Z");
    const glm53 = item("hackernews", "Cross-request KV cache exposure in the GLM-5.3 Workers AI model (155 responses)", "2026-10-26T22:41:00Z");
    expect(same(glm55, glm53)).toBe(false);
  });

  it("two launches from the same company on the same day", () => {
    const buddy = item("jiqizhixin", "刚刚，腾讯Buddy One发布，办公大一统要来了！混元Hy4也将亮相", "2026-10-29T06:41:00Z");
    const hy4 = item("36kr-flash", "腾讯混元Hy4 、Hy4 flash即将发布，首次引入视觉理解能力", "2026-10-29T02:28:00Z");
    expect(same(buddy, hy4)).toBe(false);
  });

  it("different facts about one company and amounts that merely coincide", () => {
    const record = item("techcrunch-ai", "Microsoft hits 10 quarters of record-breaking revenue in a row", "2026-10-28T21:25:00Z");
    const openai = item("verge-ai", "Microsoft recorded $10 billion in revenue from OpenAI", "2026-10-28T21:34:00Z");
    const azure = item("the-decoder", "Microsoft just shared Azure’s actual revenue in dollars: $33.2 billion", "2026-10-28T21:58:00Z");
    const fund = item("the-decoder", "Disruptive raises $10B fund to make big bets on at least 10 companies", "2026-10-28T18:55:00Z");
    expect(same(record, openai)).toBe(false);
    expect(same(openai, azure)).toBe(false);
    expect(same(fund, openai)).toBe(false);
  });

  it("a shared parameter count alone", () => {
    const rsi = item("jiqizhixin", "清华27岁助理教授杀入AI自进化赛道！首个35B模型刚刚亮相", "2026-10-28T14:33:00Z");
    const diffusion = item("infoq-cn", "不再逐个生成 Token：扩散模型迈向 35B，开始挑战 Agent 编程", "2026-10-28T14:53:00Z");
    expect(same(rsi, diffusion)).toBe(false);
  });

  it("roundups, stale reports and two pieces from one outlet", () => {
    const roundup = item("geekpark", "iPhone Duo正式交付；Kimi K3.1 Pro 、Seedance 2.5 4K正式发布；红果短剧上线防沉迷｜极客早知道", "2026-10-24T00:34:00Z");
    const kimi = item("simonw", "Introducing Kimi K3.1 Pro", "2026-10-23T19:40:00Z");
    expect(same(roundup, kimi)).toBe(false);
    const a = item("qbitai", "国产AI 3D大模型Hi3D来了！开源可商用", "2026-10-20T08:00:00Z");
    const b = item("36kr-ai", "国产AI 3D大模型Hi3D来了！开源可商用", "2026-10-25T08:00:00Z");
    expect(same(a, b)).toBe(false);
    const vcs = item("techcrunch-ai", "VCs will make billions on Anthropic’s IPO, but Amazon is set to make much (much) more", "2026-10-28T01:15:00Z");
    const governance = item("techcrunch-ai", "Who’s really in charge at Anthropic after the IPO?", "2026-10-27T21:38:00Z");
    expect(same(vcs, governance)).toBe(false);
  });
});

describe("same event, different wording", () => {
  it("matches Chinese and English reports through the model name, days apart", () => {
    const en = item("simonw", "Introducing Kimi K3.1 Pro", "2026-10-23T19:40:00Z");
    const zh = item("geekpark", "Kimi 发布 K3.1 Pro，加量降价挑战 Opus 5.5", "2026-10-26T10:16:00Z");
    const [cluster] = clusterItems([en, zh]);
    expect(cluster.members).toHaveLength(1);
    // Neither is official, so the Chinese report with more detail leads.
    expect(cluster.primary).toBe(zh);
  });

  it("matches Chinese headlines through amounts, ages and phrases", () => {
    const pi = item("qbitai", "0营收估值200亿美元，具身版OpenAI又融10亿美元", "2026-10-28T08:55:00Z");
    const pi2 = item("36kr-ai", "估值逼近200亿美元，资本看中了Physical Intelligence什么？", "2026-10-28T12:11:00Z");
    expect(same(pi, pi2)).toBe(true);
    const rsi = item("jiqizhixin", "清华27岁助理教授杀入AI自进化赛道！首个35B模型刚刚亮相", "2026-10-28T14:33:00Z");
    const rsi2 = item("36kr-ai", "海淀又投出一匹AI黑马：27岁清华教授，交出首个RSI模型", "2026-10-29T03:46:00Z");
    expect(same(rsi, rsi2)).toBe(true);
    const diffusion = item("infoq-cn", "不再逐个生成 Token：扩散模型迈向 35B，开始挑战 Agent 编程", "2026-10-28T14:53:00Z");
    const diffusion2 = item("qbitai", "刚刚，扩散模型杀进Agent主场！350亿参数，速度比Jev快一倍", "2026-10-29T02:18:00Z");
    expect(same(diffusion, diffusion2)).toBe(true);
  });

  it("matches English rewrites and syndicated copies", () => {
    const tc = item("techcrunch-ai", "Chrome’s AI-powered Autofill can now dig through your Gmail to fill out forms", "2026-10-28T17:00:00Z");
    const verge = item("verge-ai", "Chrome’s enhanced autofill can now pull info from Gmail to help you fill out forms", "2026-10-28T17:00:00Z");
    expect(same(tc, verge)).toBe(true);
    const excerpt = "The PHP scare may have faded from your feed, but the cleanup is far from over. Last week, two critical bugs in the open source language…";
    const podcast = item("techcrunch-ai", "The ‘Vulnpocalypse’ is coming for the internet’s aging code, says Wiz’s CTO", "2026-10-28T18:50:00Z", { excerpt });
    const video = item("techcrunch-ai", "Wiz’s CTO on PHP2Shell and the coming ‘vulnpocalypse’", "2026-10-28T19:05:00Z", { excerpt });
    expect(same(podcast, video)).toBe(true);
  });

  it("uses repo descriptions and a longer window for repo pages", () => {
    const repo = item("github-new", "anonnerdfrenzy/survival-llm", "2026-10-24T19:12:00Z", {
      excerpt: "A free AI assistant and survival library that runs on your own computer, with no internet needed.",
    });
    const hn = item("hackernews", "Survival LLM: AI assistant and emergency library that runs on your own computer", "2026-10-27T19:55:00Z");
    const [cluster] = clusterItems([repo, hn]);
    expect(cluster.primary).toBe(hn);
    expect(cluster.members).toEqual([repo]);
  });
});

describe("LLM hints", () => {
  const zh = item("infoq-cn", "Anthropic 内部系统被 AI Agent 12 小时攻破！会议记录、员工薪酬、内部模型讨论遭访问", "2026-10-28T09:54:00Z");
  const en = item("the-decoder", "AI agents hacked Anthropic, maker of arguably the most capable AI models for cyberdefense", "2026-10-28T10:56:00Z");

  it("merge cross-language reports the heuristics cannot link", () => {
    expect(same(zh, en)).toBe(false);
    expect(compareItems(zh, en, new Set([pairKey(zh.id, en.id)])).same).toBe(true);
  });

  it("cannot override model, time or same-source vetoes", () => {
    const terra = item("openai", "Introducing GPT-6.1 Terra", "2026-10-26T00:00:00Z");
    const sol = item("simonw", "GPT-6.1 Sol", "2026-10-26T10:00:00Z");
    expect(compareItems(terra, sol, new Set([pairKey(terra.id, sol.id)])).same).toBe(false);
    const late = item("the-decoder", "Anthropic confirms breach", "2026-11-03T10:00:00Z");
    expect(compareItems(zh, late, new Set([pairKey(zh.id, late.id)])).same).toBe(false);
    const sameSource = item("infoq-cn", "AI 智能体攻破 Anthropic 的过程复盘", "2026-10-28T12:00:00Z");
    expect(compareItems(zh, sameSource, new Set([pairKey(zh.id, sameSource.id)])).same).toBe(false);
  });
});

describe("applyClusters", () => {
  it("splits a card again when the reports no longer match", () => {
    const a = item("qbitai", "国产AI 3D大模型Hi3D来了！开源可商用，PK干掉GPT-6", "2026-10-27T08:18:00Z");
    const b = item("geekpark", "左手开源模型，右手创作 Agent，Hi3D 的 AI 3D 下半场", "2026-10-27T07:59:00Z");
    applyClusters([a, b]);
    const [primary, member] = a.dupOf ? [b, a] : [a, b];
    expect(member.dupOf).toBe(primary.id);
    expect(primary.related?.[0]).toMatchObject({ id: member.id, title: member.title });
    const merged = primary.score;
    member.title = "具身智能军备竞赛，胜负手在工程生态";
    const outcome = applyClusters([a, b]);
    expect(outcome.changed).toHaveLength(2);
    expect(member.dupOf).toBeUndefined();
    expect(primary.related).toBeUndefined();
    expect(primary.story).toBeUndefined();
    expect(primary.score).toBeLessThan(merged);
  });

  it("leaves items whose primary is outside the window alone", () => {
    const orphan = item("qbitai", "某条旧报道", "2026-10-29T00:00:00Z", { dupOf: "not-loaded" });
    const outcome = applyClusters([orphan]);
    expect(orphan.dupOf).toBe("not-loaded");
    expect(outcome.changed).toEqual([]);
  });
});
