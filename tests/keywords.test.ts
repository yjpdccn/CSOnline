import { describe, expect, it } from "vitest";
import { categorize, checkAiRelevance, compileTerm, matchTopics } from "@/lib/pipeline/keywords";

describe("compileTerm", () => {
  it("matches case-sensitive acronyms on word boundaries, including next to Chinese", () => {
    const ai = compileTerm("=AI").re;
    expect(ai.test("AI短剧爆发")).toBe(true);
    expect(ai.test("New AI-powered search")).toBe(true);
    expect(ai.test("He said hi")).toBe(false);
    expect(ai.test("OpenAI ships")).toBe(false);
    expect(ai.test("Ai Weiwei exhibition")).toBe(false);
  });

  it("supports suffix wildcards and version wildcards", () => {
    expect(compileTerm("Qwen*").re.test("Qwen3.8-Max 发布")).toBe(true);
    expect(compileTerm("Gemini *").re.test("Gemini 4 Carbon")).toBe(true);
    expect(compileTerm("Opus *").re.test("Opus is great")).toBe(false);
    expect(compileTerm("repo").re.test("annual report")).toBe(false);
  });
});

describe("checkAiRelevance", () => {
  it.each([
    ["Show HN: A local LLM runner in 300 lines", true],
    ["Claude Code now supports MCP servers", true],
    ["字节 Seedance 2.5 让 AI 短剧进入量产", true],
    ["腾讯混元Hy4即将发布", true],
    ["The history of the Roman aqueducts", false],
    ["FBI agent arrested in Ohio", false],
    ["Apple reports record iPhone sales", false],
  ])("%s → %s", (title, expected) => {
    expect(checkAiRelevance(title).relevant).toBe(expected);
  });

  it("accepts body-only matches when two strong keywords appear", () => {
    expect(checkAiRelevance("A new startup launches", "The company trains large language models and AI agents").relevant).toBe(true);
    expect(checkAiRelevance("A new startup launches", "It mentions AI once").relevant).toBe(false);
  });
});

describe("categorize", () => {
  it.each([
    ["Google releases Veo 4, its most capable video generation model", "multimodal"],
    ["Introducing GPT-6.1 Terra", "model"],
    ["DeepSeek 开源新模型 V5，推理能力大幅提升", "model"],
    ["OpenAI raises $40B at a $500B valuation", "industry"],
    ["Building MCP servers for your database", "agent"],
    ["Anthropic 推出个人 AI 助理，支持 Claude Code 与 Agent Skills", "agent"],
    ["NeurIPS 2026 最佳论文出炉", "paper"],
    ["大模型内卷之后，AI 竞争进入搜索基础设施时代", "industry"],
    ["AI 漫剧越做越快，赚钱却没那么容易了", "multimodal"],
  ])("%s → %s", (title, expected) => {
    expect(categorize(title)).toBe(expected);
  });

  it("falls back to the source default when nothing matches", () => {
    expect(categorize("Mapping the world's forests", "", "paper")).toBe("paper");
  });
});

describe("matchTopics", () => {
  it("tags hot topics", () => {
    expect(matchTopics("Agents that speak A2UI and MCP")).toEqual(["Agent", "MCP", "A2UI"]);
    expect(matchTopics("用 Seedance 做 AI 短剧")).toEqual(["视频生成", "AI 短剧"]);
  });
});
