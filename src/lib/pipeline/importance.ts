import { SOURCES } from "@/config/sources";
import type { Metrics, NewsItem } from "@/lib/types";
import { isOfficial } from "./cluster";
import { coverage } from "./score";
import { isRoundup, storyFeatures } from "./similarity";
import { translatedTitle } from "./text";

/**
 * Time-independent importance of a card (its primary item plus the reports folded into it).
 * The page and 今日要点 decay it with age and diversify it in `rankStories` (lib/rank.ts).
 */

/** How much a report from each source says about importance on its own. */
const AUTHORITY: Record<string, number> = {
  // Labs announcing their own models and products
  openai: 22, anthropic: 22, deepmind: 22, "google-ai": 22, deepseek: 22, meta: 20, qwen: 20, seed: 18, mistral: 18,
  // Official engineering and research blogs, which also publish many smaller posts
  "microsoft-ai": 16, "google-dev": 15, "google-research": 15, "hf-blog": 15, nvidia: 14, "apple-ml": 14,
  "microsoft-research": 14, "meta-engineering": 13,
  // Leading AI media
  jiqizhixin: 16, qbitai: 16, "techcrunch-ai": 16, "verge-ai": 16, "the-decoder": 15,
  // Other media and bloggers
  "36kr-ai": 13, geekpark: 13, simonw: 13, "36kr-flash": 12, leiphone: 12, "infoq-cn": 12, baoyu: 12,
  // Discussions and listings: their engagement counts, not the source itself
  hackernews: 10, "hf-papers": 8, "reddit-localllama": 7, "github-trending": 6, "github-new": 5, "hf-models": 5,
};
const GROUP_AUTHORITY: Record<NewsItem["sourceGroup"], number> = { official: 15, "media-en": 13, "media-zh": 12, blogger: 11, community: 6 };
/** A discussion that links straight to an official page (an HN post of anthropic.com/research/…). */
const OFFICIAL_LINK_AUTHORITY = 20;

const ZH_SOURCES = new Set(SOURCES.filter((s) => s.lang === "zh" || s.group === "media-zh").map((s) => s.id));

const RELEASE = /发布|开源|上线|推出|官宣|亮相|launch|release|introduc|announc|unveil|now available|debut/i;
/** Labs and companies whose moves set the agenda; their flagship products count too. */
const BIG_COMPANY = new RegExp(
  [
    String.raw`\b(?:openai|chatgpt|gpt-?\d[\w.]*|codex|sora|anthropic|claude|google|deepmind|gemini|gemma|chrome|gmail|android|youtube`,
    String.raw`meta|llama|whatsapp|instagram|microsoft|copilot|azure|windows|nvidia|apple|iphone|siri|amazon|aws|alexa|xai|grok`,
    String.raw`deepseek|qwen|doubao|seedance|tiktok|hunyuan|wechat|kimi|moonshot|zhipu|glm-?\d[\w.]*)\b`,
    "谷歌|微软|英伟达|苹果|亚马逊|阿里|通义|千问|淘宝|字节|豆包|即梦|抖音|腾讯|混元|微信|百度|文心|月之暗面|智谱|华为|蚂蚁|支付宝|深度求索",
  ].join("|"),
  "i",
);
const BIG_COMPANY_SOURCES = new Set([
  "openai", "anthropic", "deepmind", "google-ai", "google-dev", "google-research", "meta", "meta-engineering", "microsoft-ai",
  "microsoft-research", "nvidia", "apple-ml", "deepseek", "qwen", "seed",
]);

export interface ImportanceParts {
  authority: number;
  coverage: number;
  engagement: number;
  release: number;
  company: number;
  /** Multi-story roundups are discounted. */
  roundup: boolean;
}

const log = (value: number, scale: number, multiplier: number, cap: number) => Math.min(cap, multiplier * Math.log2(1 + value / scale));

function engagement(m: Metrics | undefined): number {
  if (!m) return 0;
  let score = 0;
  if (m.points) score += log(m.points, 40, 7, 18);
  if (m.comments) score += log(m.comments, 40, 2.5, 6);
  if (m.upvotes) score += log(m.upvotes, 25, 5, 12);
  if (m.likes) score += log(m.likes, 150, 4, 10);
  if (m.starsToday) score += log(m.starsToday, 150, 5, 12);
  else if (m.stars) score += log(m.stars, 1000, 3, 8);
  return Math.min(22, score);
}

/** Sources on the card: the primary's, then discussions and reports folded into it. */
export function cardSources(item: NewsItem): string[] {
  return item.story?.sources ?? [...new Set([item.sourceId, ...(item.alsoOn ?? []).map((a) => a.sourceId)])];
}

export function importanceParts(item: NewsItem): ImportanceParts {
  const sources = cardSources(item);
  let authority = Math.max(...sources.map((s) => AUTHORITY[s] ?? (s === item.sourceId ? GROUP_AUTHORITY[item.sourceGroup] : 10)));
  if (item.sourceGroup !== "official" && isOfficial(item)) authority = Math.max(authority, OFFICIAL_LINK_AUTHORITY);

  const others = coverage(item);
  const reports = item.story?.reports ?? 1 + (item.alsoOn?.length ?? 0);
  const repeats = Math.max(0, reports - 1 - others);
  const bilingual = sources.some((s) => ZH_SOURCES.has(s)) && sources.some((s) => !ZH_SOURCES.has(s));
  const coverageScore = 14 * Math.log2(1 + others) + 2 * Math.min(3, repeats) + (bilingual ? 4 : 0);

  const headline = [item.title, translatedTitle(item)].filter(Boolean).join(" ");
  const releaseWord = RELEASE.test(headline);
  const hasModel = storyFeatures(item.title).models.length > 0;
  const bigCompany = BIG_COMPANY.test(headline) || sources.some((s) => BIG_COMPANY_SOURCES.has(s));
  const officialSource = sources.some((s) => SOURCES.find((c) => c.id === s)?.group === "official");
  let release = 0;
  // A named, versioned model being released; major when a big lab ships it or several outlets cover it.
  if (hasModel && (releaseWord || others >= 2)) release = bigCompany || officialSource || others >= 2 ? 14 : 6;
  else if (item.category === "model" && releaseWord) release = 6;

  const company = bigCompany ? 6 : 0;

  return {
    authority,
    coverage: Math.round(coverageScore * 10) / 10,
    engagement: Math.round(engagement(item.story?.metrics ?? item.metrics) * 10) / 10,
    release,
    company,
    roundup: isRoundup(item),
  };
}

export function importanceWeight(parts: ImportanceParts): number {
  const sum = parts.authority + parts.coverage + parts.engagement + parts.release + parts.company;
  return Math.round(sum * (parts.roundup ? 0.6 : 1) * 10) / 10;
}

export function storyWeight(item: NewsItem): number {
  return importanceWeight(importanceParts(item));
}

/** Earliest report of the story, when it predates the primary. */
export function storyFirstAt(item: NewsItem): string | undefined {
  const first = item.story?.firstPublishedAt;
  return first && first < item.publishedAt ? first : undefined;
}
