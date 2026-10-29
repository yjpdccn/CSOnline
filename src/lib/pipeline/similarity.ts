import type { NewsItem } from "@/lib/types";
import { titleFingerprint, titleSimilarity } from "./text";

/**
 * Story-level similarity for cross-source dedupe. A headline is reduced to weighted terms: Chinese
 * character bigrams, English words, model names with versions ("gemini4" plus variant "carbon"),
 * numbers with units (200亿美元 and $20B are the same amount) and company names in either language.
 * Nothing here needs an LLM.
 */

const COMPANY_ALIASES: [string, string[]][] = [
  ["google", ["google deepmind", "google", "deepmind", "谷歌"]],
  ["openai", ["openai"]],
  ["anthropic", ["anthropic"]],
  ["meta", ["meta", "facebook"]],
  ["microsoft", ["microsoft", "微软"]],
  ["nvidia", ["nvidia", "英伟达"]],
  ["apple", ["apple", "苹果"]],
  ["amazon", ["amazon", "aws", "亚马逊云科技", "亚马逊"]],
  ["alibaba", ["alibaba", "阿里巴巴", "阿里云", "阿里"]],
  ["tencent", ["tencent", "腾讯"]],
  ["bytedance", ["bytedance", "字节跳动", "字节"]],
  ["baidu", ["baidu", "百度", "文心"]],
  ["deepseek", ["deepseek", "深度求索"]],
  ["moonshot", ["moonshot", "kimi", "月之暗面"]],
  ["zhipu", ["zhipu", "智谱"]],
  ["xai", ["xai"]],
  ["mistral", ["mistral"]],
  ["huawei", ["huawei", "华为"]],
  ["xiaomi", ["xiaomi", "小米"]],
  ["ant", ["蚂蚁集团", "蚂蚁"]],
  ["unitree", ["unitree", "宇树"]],
  ["tesla", ["tesla", "特斯拉"]],
  ["samsung", ["samsung", "三星"]],
  ["intel", ["intel", "英特尔"]],
  ["amd", ["amd"]],
  ["huggingface", ["hugging face", "huggingface"]],
  ["minimax", ["minimax", "稀宇"]],
  ["oracle", ["oracle", "甲骨文"]],
  ["ibm", ["ibm"]],
  ["stanford", ["stanford", "斯坦福"]],
  ["tsinghua", ["tsinghua", "清华"]],
];

const COMPANY_PATTERNS = COMPANY_ALIASES.flatMap(([canonical, aliases]) =>
  aliases.map((alias) => ({
    canonical,
    re: CJK_TEST(alias)
      ? new RegExp(alias, "g")
      : new RegExp(`(?<![A-Za-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "gi"),
  })),
);

function CJK_TEST(s: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(s);
}

const STOP = new Set(
  (
    "a an the and or nor of to in on for with from by at as is are was were be been being it its this that these those " +
    "your you our we they their his her my me us i he she them can could will would should may might must now just how what " +
    "why who whom when where which about into over after before than then more most up out not no all any some also here " +
    "there so but if do does did done has have had get gets got make makes made says said say via vs per own really much " +
    "still only even back way being very too again against across between through during under while because each both " +
    "few other such same off down once let lets like one two three four five six seven eight nine ten first second third"
  ).split(" "),
);

/** Common in AI news headlines, so sharing them says little about whether two stories match. */
const GENERIC_WORDS = new Set(
  (
    "ai model models agent agents agentic llm llms new open opens opened launch launches launched release releases released " +
    "introduce introduces introduced introducing announce announces announced unveil unveils unveiled update updates updated " +
    "tool tools app apps platform company companies user users people research researchers study report reports data system " +
    "systems use uses using used help helps build builds building work works world time year years day days week big small " +
    "top best better faster free available support supports latest next generation power powered based real today tech " +
    "technology want wants need needs show shows find finds found know future part plan plans start starts going go " +
    "news video videos image images chat chatbot bot bots service services product products feature features business " +
    "intelligence artificial digital online internet web developer developers team teams million billion personal token " +
    "tokens api apis app sdk cli gpu gpus cpu chip chips coding code"
  ).split(" "),
);

/** Very frequent bigrams in Chinese AI headlines. */
const GENERIC_BIGRAMS = new Set(
  (
    "模型 智能 发布 大模 来了 开源 具身 身智 机器 器人 技术 工程 世界 中国 物理 数据 能力 科技 企业 知道 什么 用户 " +
    "算力 走向 能体 一个 完成 宣布 挑战 任务 第一 启动 应用 开始 工作 视频 基础 时代 终于 自己 国产 亮相 问题 生成 " +
    "软件 开发 研究 未来 员工 提出 交互 研发 训练 实时 如何 正式 全面 首个 首次 最新 新一 一代 人工 工智 行业 公司 " +
    "产品 已经 可以 我们 他们 没有 还是 不是 就是 表示 回应 进行 实现 推出 上线 合作 进入 发展 全球 时间 今天 现在 " +
    "这个 为什 么要 怎么 背后 真正 不再 开启 打造 新的 正在 不会 一款 系统 平台 方案 全新 重磅 突发 独家 官宣 刚刚"
  ).split(" "),
);

/** Words that name a model variant when they follow a versioned model name ("GPT-6.1 Terra", "Hy4 flash"). */
const VARIANT_WORDS = new Set(
  (
    "pro max mini nano flash lite ultra turbo plus preview instant thinking omni vision coder chat base instruct air edge " +
    "live realtime transcribe large medium small exp experimental next spark wonder deep fast highspeed"
  ).split(" "),
);

/** Capitalized words that look like a name when followed by a number but are not models ("Top 10", "Day 2"). */
const NO_JOIN = new Set(
  "top day days part phase step week weeks chapter season episode page vol no number round level gen covid the in on at of over up to".split(
    " ",
  ),
);

const CJK_RUN = /[\u3400-\u9fff\uf900-\ufaff]+/g;
const LATIN_TOKEN = /[A-Za-z0-9]+(?:\.\d+)*[A-Za-z0-9]*/g;

const MODEL_TOKEN = /^([a-z]+)(\d+(?:\.\d+)*)([a-z]?)$/;
/** Quarters, halves, autonomy levels and active-parameter counts look like model names but are not. */
const NOT_A_MODEL = /^(?:q[1-4]|h[12]|l[0-5]|p[0-9]|fy\d+|a\d+b)$/;
/** owner/name ids from GitHub and Hugging Face. */
const ARTIFACT_ID = /^[\w.-]+\/([\w.-]+)$/;

/** Roundup posts list many unrelated stories; merging one into a single story would hide the rest. */
const ROUNDUP_TITLE = /极客早知道|早报|晚报|早参|周报|日报|要闻|一周|8点1氪|this week in|weekly|roundup|newsletter|recap/i;
const ROUNDUP_URL = /\/zaobao\//;

export interface ModelMention {
  family: string;
  version: string;
  variant?: string;
}

export interface StoryFeatures {
  terms: Map<string, number>;
  total: number;
  models: ModelMention[];
  /** Model keys ("gemini4+carbon") and proper nouns in headline order. */
  names: string[];
  /** Money amounts in the title. */
  money: { currency: string; value: number }[];
  /** Punctuation-free title used for the near-identical check. */
  print: string;
  lang: "zh" | "en";
}

export function normalizeHeadline(title: string): string {
  return title
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/^\s*【[^】]{1,24}】\s*/u, "")
    .replace(/^\s*(?:刚刚|重磅|突发|独家|快讯|官宣|最新|速看|炸裂)\s*[,，!！:：|｜、\s]\s*/u, "")
    .replace(/^\s*(?:introducing|announcing|breaking|exclusive|show hn|ask hn|launch hn|tell hn)\s*[:：\-–—]?\s+/i, "")
    .replace(/^\s*\[(?:d|r|p|n|news|discussion)\]\s*/i, "")
    .replace(/\s*[·|｜]\s*hugging face\s*$/i, "")
    .replace(/\s*[|｜]\s*极客早知道\s*$/u, "")
    .trim();
}

export function isRoundup(item: Pick<NewsItem, "title" | "url">): boolean {
  if (ROUNDUP_URL.test(item.url)) return true;
  const title = item.title.normalize("NFKC");
  if (ROUNDUP_TITLE.test(title)) return true;
  // "A；B；C" headlines bundle several stories.
  return (title.match(/[;；]/g)?.length ?? 0) >= 2;
}

const MAGNITUDE: Record<string, number> = {
  k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, t: 1e12, tn: 1e12, trillion: 1e12,
  千: 1e3, 万: 1e4, 亿: 1e8, 万亿: 1e12,
};

const CURRENCY: Record<string, string> = { $: "usd", 美元: "usd", 美金: "usd", 元: "cny", 人民币: "cny", "£": "gbp", 英镑: "gbp", "€": "eur", 欧元: "eur" };

const numKey = (n: number) => n.toPrecision(3);

function addTerm(terms: Map<string, number>, term: string, weight: number) {
  if (!term || weight <= 0) return;
  const prev = terms.get(term);
  if (prev === undefined || weight > prev) terms.set(term, weight);
}

/** Pulls money, magnitudes, percentages and unit counts out of the text and blanks them. */
function extractNumbers(text: string, terms: Map<string, number>, money: StoryFeatures["money"]): string {
  const num = (s: string) => Number(s.replace(/,/g, ""));
  const addMoney = (currency: string, value: number) => {
    money.push({ currency, value });
    addTerm(terms, `${currency}:${numKey(value)}`, 3);
  };
  let t = text;
  t = t.replace(/([$£€])\s?(\d[\d,]*(?:\.\d+)?)\s*(trillion|billion|million|thousand|bn|tn|mn|[kmbt])?(?![a-z])/gi, (_, cur, n, unit) => {
    addMoney(CURRENCY[cur], num(n) * (unit ? MAGNITUDE[unit.toLowerCase()] : 1));
    return " ";
  });
  t = t.replace(/(\d[\d,]*(?:\.\d+)?)\s*(万亿|亿|万|千)?\s*(美元|美金|人民币|英镑|欧元|元)/g, (_, n, unit, cur) => {
    addMoney(CURRENCY[cur], num(n) * (unit ? MAGNITUDE[unit] : 1));
    return " ";
  });
  t = t.replace(/(\d[\d,]*(?:\.\d+)?)\s*(万亿|亿|万)/g, (_, n, unit) => {
    addTerm(terms, `n:${numKey(num(n) * MAGNITUDE[unit])}`, 2);
    return " ";
  });
  t = t.replace(/(?<![a-z0-9.])(\d+(?:\.\d+)?)\s*(trillion|billion|million)\b/gi, (_, n, unit) => {
    addTerm(terms, `n:${numKey(num(n) * MAGNITUDE[unit.toLowerCase()])}`, 2);
    return " ";
  });
  t = t.replace(/(?<![a-z0-9.])(\d+(?:\.\d+)?)([kmbt])(?![a-z0-9])/gi, (_, n, unit) => {
    addTerm(terms, `n:${numKey(num(n) * MAGNITUDE[unit.toLowerCase()])}`, 2);
    return " ";
  });
  t = t.replace(/(\d+(?:\.\d+)?)\s*%/g, (_, n) => {
    addTerm(terms, `pct:${num(n)}`, 2);
    return " ";
  });
  t = t.replace(/(\d+(?:\.\d+)?)\s*(岁|小时|分钟|天|台|支|家|项|倍|位|款|名|页|道|周年|公里|个月)/g, (_, n, unit) => {
    addTerm(terms, `u:${num(n)}${unit}`, 2);
    return " ";
  });
  return t;
}

function replaceCompanies(text: string, terms: Map<string, number>): string {
  let t = text;
  for (const { canonical, re } of COMPANY_PATTERNS) {
    re.lastIndex = 0;
    if (!re.test(t)) continue;
    addTerm(terms, `@${canonical}`, 1);
    t = t.replace(re, " ");
  }
  return t;
}

/** Words of 8+ letters keep their first 7, so transcribe/transcription and developer/development meet. */
function stem(word: string): string {
  if (word.length >= 8) return word.slice(0, 7);
  if (word.length > 4 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function isTitleCase(tokens: string[]): boolean {
  const words = tokens.filter((t) => /^[A-Za-z]{4,}$/.test(t));
  if (words.length < 3) return false;
  return words.filter((w) => /^[A-Z]/.test(w)).length / words.length >= 0.7;
}

interface Token {
  raw: string;
  low: string;
  /** Text between the previous token and this one. */
  sep: string;
  /** First token of a sentence-case English headline (capitalized for grammar, not because it is a name). */
  first: boolean;
}

function latinTokens(text: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const m of text.matchAll(LATIN_TOKEN)) {
    tokens.push({ raw: m[0], low: m[0].toLowerCase(), sep: text.slice(last, m.index), first: last === 0 && !text.slice(0, m.index).trim() });
    last = m.index + m[0].length;
  }
  // "Gemini 4", "GPT-6.1", "OCR 2", "S-1" become one model token; "Granary v2" becomes granaryv2.
  const joined: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const cur = tokens[i];
    const next = tokens[i + 1];
    const joinable =
      next && /^(?:|\s|-)$/.test(next.sep) && /^[A-Za-z]+$/.test(cur.raw) && /[A-Z]/.test(cur.raw) && !NO_JOIN.has(cur.low);
    const version = joinable && /^\d{1,2}(?:\.\d+)*[a-ce-jln-su-z]?$/i.test(next.raw);
    const vSuffix = joinable && next.sep === " " && /^v\d+(?:\.\d+)*$/i.test(next.raw);
    if (version || vSuffix) {
      joined.push({ ...cur, raw: cur.raw + next.raw, low: cur.low + next.low });
      i++;
    } else {
      joined.push(cur);
    }
  }
  return joined;
}

export interface FeatureOptions {
  /** Repo or model description; artifact ids like "owner/name" say little on their own. */
  description?: string;
  /** Extra low-weight bigrams and words for another domain, e.g. 美联储/利率 in finance news. */
  generic?: ReadonlySet<string>;
}

export function storyFeatures(title: string, opts: FeatureOptions = {}): StoryFeatures {
  let normalized = normalizeHeadline(title);
  const artifact = normalized.match(ARTIFACT_ID);
  const owner = artifact ? normalized.slice(0, normalized.indexOf("/")) : undefined;
  if (artifact) normalized = artifact[1].replace(/[-_]+/g, " ");
  const print = titleFingerprint(normalized);
  const terms = new Map<string, number>();
  const money: StoryFeatures["money"] = [];
  const models: ModelMention[] = [];
  const names: string[] = [];

  let text = normalized;
  if (opts.description) text += ` | ${opts.description.normalize("NFKC").split(/(?<=[.!?。！？])\s/)[0]}`;
  if (owner) text += ` | ${owner}`;
  const lang = (normalized.match(CJK_RUN)?.join("").length ?? 0) >= 4 ? "zh" : "en";

  text = text.replace(/([A-Za-z0-9])'s\b/g, "$1");
  text = extractNumbers(text, terms, money);
  text = replaceCompanies(text, terms);

  for (const run of text.match(CJK_RUN) ?? []) {
    const chars = Array.from(run);
    for (let i = 0; i < chars.length - 1; i++) {
      const gram = chars[i] + chars[i + 1];
      addTerm(terms, gram, GENERIC_BIGRAMS.has(gram) || opts.generic?.has(gram) ? 0.3 : 1);
    }
  }

  const tokens = latinTokens(text.replace(CJK_RUN, " | "));
  const titleCase = lang === "en" && isTitleCase(tokens.map((t) => t.raw));
  tokens.forEach((token, i) => {
    const low = token.low;
    if (/^\d/.test(low)) return;
    const model = low.match(MODEL_TOKEN);
    if (model && !NOT_A_MODEL.test(low)) {
      const family = model[1];
      const version = model[2].replace(/(?:\.0)+$/, "") + model[3];
      const name = family + version;
      const next = tokens[i + 1];
      let variant: string | undefined;
      if (next && /^[\s-]$/.test(next.sep) && /^[a-z]+$/.test(next.low) && !STOP.has(next.low)) {
        const capitalized = /^[A-Z]/.test(next.raw) && !titleCase && !GENERIC_WORDS.has(next.low);
        if (VARIANT_WORDS.has(next.low) || capitalized) variant = next.low;
      }
      models.push({ family, version, variant });
      names.push(variant ? `${name}+${variant}` : name);
      addTerm(terms, name, 3);
      if (variant) addTerm(terms, `${name}+${variant}`, 2);
      if (family.length >= 3) addTerm(terms, family, 0.5);
      return;
    }
    if (STOP.has(low) || low.length < 2) return;
    if (GENERIC_WORDS.has(low) || opts.generic?.has(low)) {
      addTerm(terms, stem(low), 0.3);
      return;
    }
    const term = stem(low);
    const mixedCase = /[A-Z]/.test(token.raw.slice(1)) && /[a-z]/.test(token.raw);
    const properNoun = lang === "zh" || mixedCase || (!titleCase && !token.first && /^[A-Z]/.test(token.raw));
    if (properNoun) names.push(term);
    addTerm(terms, term, properNoun ? 1.5 : 1);
  });

  let total = 0;
  for (const w of terms.values()) total += w;
  return { terms, total, models, names, money, print, lang };
}

/** Same model family with different versions (GLM-5.3 vs GLM-5.5) or variants (GPT-6.1 Terra vs Sol). */
export function modelConflict(a: ModelMention[], b: ModelMention[]): string | null {
  for (const ma of a) {
    const sameFamily = b.filter((mb) => mb.family === ma.family);
    if (!sameFamily.length) continue;
    const aVersions = a.filter((m) => m.family === ma.family);
    const shared = aVersions.filter((x) => sameFamily.some((y) => y.version === x.version));
    if (!shared.length) return `${ma.family} ${aVersions.map((m) => m.version).join("/")} ≠ ${sameFamily.map((m) => m.version).join("/")}`;
    for (const x of shared) {
      const variantsA = aVersions.filter((m) => m.version === x.version && m.variant).map((m) => m.variant);
      const variantsB = sameFamily.filter((m) => m.version === x.version && m.variant).map((m) => m.variant);
      if (variantsA.length && variantsB.length && !variantsA.some((v) => variantsB.includes(v))) {
        return `${x.family}${x.version} ${variantsA.join("/")} ≠ ${variantsB.join("/")}`;
      }
    }
  }
  return null;
}

function moneyConflict(a: StoryFeatures["money"], b: StoryFeatures["money"]): boolean {
  if (!a.length || !b.length) return false;
  return !a.some((x) => b.some((y) => x.currency === y.currency && Math.abs(x.value - y.value) <= 0.1 * Math.max(x.value, y.value)));
}

export interface Overlap {
  shared: number;
  /** Shared weight that is neither a company name nor a generic word. */
  specific: number;
  /** Distinct shared specific terms; a lone number or amount is not enough. */
  specificTerms: number;
  sharedModel: boolean;
  dice: number;
  cover: number;
}

export function termOverlap(a: StoryFeatures, b: StoryFeatures): Overlap {
  let shared = 0;
  let specific = 0;
  let specificTerms = 0;
  let sharedModel = false;
  for (const [term, wa] of a.terms) {
    const wb = b.terms.get(term);
    if (wb === undefined) continue;
    const w = Math.min(wa, wb);
    shared += w;
    if (term.startsWith("@") || w <= 0.5) continue;
    // Parameter counts like "4B" recur across unrelated models.
    specific += term.startsWith("n:") ? Math.min(w, 1.5) : w;
    specificTerms++;
    if (MODEL_TOKEN.test(term)) sharedModel = true;
  }
  const total = a.total + b.total;
  const smaller = Math.min(a.total, b.total);
  return { shared, specific, specificTerms, sharedModel, dice: total ? (2 * shared) / total : 0, cover: smaller ? shared / smaller : 0 };
}

/** Near-identical headlines: the same wording with different punctuation, or one headline extending the other. */
export function nearIdentical(a: Pick<StoryFeatures, "print">, b: Pick<StoryFeatures, "print">): boolean {
  if (Array.from(a.print).length < 6 || Array.from(b.print).length < 6) return false;
  if (titleSimilarity(a.print, b.print) >= 0.8) return true;
  const [shorter, longer] = a.print.length <= b.print.length ? [a.print, b.print] : [b.print, a.print];
  const minLength = CJK_TEST(shorter) ? 10 : 16;
  return Array.from(shorter).length >= minLength && (longer.startsWith(shorter) || longer.endsWith(shorter));
}

const isModelKey = (name: string) => {
  const base = name.split("+")[0];
  return MODEL_TOKEN.test(base) && !NOT_A_MODEL.test(base);
};

/**
 * Both headlines lead with a name and one of those names is missing from the other headline:
 * "腾讯 Buddy One 发布…混元 Hy4 也将亮相" and "腾讯混元 Hy4 即将发布" are two different launches.
 */
function headlineConflict(a: StoryFeatures, b: StoryFeatures): boolean {
  const ha = a.names[0];
  const hb = b.names[0];
  if (!ha || !hb || ha === hb) return false;
  const present = (name: string, other: StoryFeatures) => {
    const base = name.split("+")[0];
    if (other.terms.has(base)) return true;
    const family = base.match(MODEL_TOKEN)?.[1];
    return Boolean(family && other.models.some((m) => m.family === family));
  };
  return !present(ha, b) || !present(hb, a);
}

/** Facts that rule a match out whatever else the headlines share: "GLM-5.3" vs "GLM-5.5", "$10B" vs "$33.2B". */
export function conflictReason(a: StoryFeatures, b: StoryFeatures): string | null {
  const conflict = modelConflict(a.models, b.models) ?? modelConflict(b.models, a.models);
  if (conflict) return `型号不同：${conflict}`;
  if (moneyConflict(a.money, b.money)) return "金额不同";
  return null;
}

export type MatchStrength = "strong" | "normal" | "none";

export interface MatchResult {
  strength: MatchStrength;
  score: number;
  reason: string;
  /** Strong only because both headlines lead with the same model; callers may require closeness in time. */
  byModel?: boolean;
  /** Whether the word overlap alone would have been enough. */
  overlapOk?: boolean;
}

/** Score needed when the evidence is word overlap rather than a shared headline model. */
export const MATCH_THRESHOLD = 0.25;
/** Shared specific weight needed on top of the score: about two distinctive words, or one model name. */
const MIN_SPECIFIC = 2.5;

/**
 * Whether two headlines report the same event, ignoring time and source.
 * - strong: near-identical wording, or both lead with the same model name and variant
 * - normal: enough overlap in distinctive terms (names, numbers, Chinese phrases)
 * Different model versions or money amounts rule a match out.
 */
export function compareFeatures(a: StoryFeatures, b: StoryFeatures): MatchResult {
  const veto = conflictReason(a, b);
  if (veto) return { strength: "none", score: 0, reason: veto };
  if (nearIdentical(a, b)) return { strength: "strong", score: 1, reason: "标题几乎相同" };
  const o = termOverlap(a, b);
  const score = Math.min(1, Math.max(o.dice, 0.85 * o.cover * Math.min(1, o.shared / 6)));
  const overlapOk = score >= MATCH_THRESHOLD && o.specific >= MIN_SPECIFIC && (o.specificTerms >= 2 || o.sharedModel);
  const head = a.names[0];
  if (head && head === b.names[0] && isModelKey(head)) {
    return { strength: "strong", score: Math.max(score, 0.6), reason: `同一型号 ${head}`, byModel: true, overlapOk };
  }
  if (headlineConflict(a, b)) return { strength: "none", score, reason: `主体不同：${a.names[0]} / ${b.names[0]}` };
  if (overlapOk) return { strength: "normal", score, reason: `关键词重合 ${o.specific.toFixed(1)}`, overlapOk };
  return { strength: "none", score, reason: `重合不足 ${o.specific.toFixed(1)}` };
}
