import {
  CHINA_CONTEXT,
  CHINA_TOPICS,
  COMPANY_FILING,
  FOREIGN_CONTEXT,
  MACRO_RULES,
  ROUNDUP,
  TOPIC_PATTERNS,
  type InvestTopic,
} from "@/config/invest-news";

const BIG_TECH_RESULTS = TOPIC_PATTERNS["us-stocks"][2];

/** "宁德时代：第三季度净利润…" is about one company, not the market (the largest US tech names excepted). */
export function isCompanyFiling(title: string, excerpt = ""): boolean {
  if (BIG_TECH_RESULTS.test(title)) return false;
  if (COMPANY_FILING.holder.test(title)) return true;
  if (!COMPANY_FILING.prefix.test(title)) return false;
  return COMPANY_FILING.terms.test(`${title} ${excerpt.slice(0, 80)}`);
}

export function isRoundupPost(title: string): boolean {
  return ROUNDUP.test(title);
}

export interface TopicContext {
  sourceId: string;
  lang: "zh" | "en";
  /** Topics every item of the source carries, e.g. the Fed's own releases. */
  implicit?: InvestTopic[];
}

/**
 * Which tracked markets a report is about; an empty list means it is dropped. The headline decides, plus
 * the lead of the text, which for 7x24 items often names the market the headline leaves out.
 */
export function investTopics(title: string, excerpt: string | undefined, ctx: TopicContext): InvestTopic[] {
  const text = `${title} ${(excerpt ?? "").slice(0, 60)}`;
  const topics = new Set<InvestTopic>(ctx.implicit ?? []);
  for (const [topic, patterns] of Object.entries(TOPIC_PATTERNS) as [InvestTopic, RegExp[]][]) {
    if (patterns.some((re) => re.test(text))) topics.add(topic);
  }
  if (/央行/.test(text) && !FOREIGN_CONTEXT.test(text)) topics.add("pboc");
  const { MACRO_INDICATOR, MACRO_INDICATOR_EN, CN_INDICATOR, CN_MARKER, US_MARKER, NON_US_MARKER } = MACRO_RULES;
  const official = ctx.sourceId === "nbs";
  if (official ? CN_INDICATOR.test(text) || /采购经理指数|居民消费价格|工业生产者|国内生产总值/.test(text) : CN_INDICATOR.test(text) && CN_MARKER.test(text)) {
    topics.add("macro-cn");
  }
  if (MACRO_INDICATOR.test(text) || MACRO_INDICATOR_EN.test(text)) {
    const us = US_MARKER.test(text) || (ctx.lang === "en" && !NON_US_MARKER.test(text));
    if (us) topics.add("macro-us");
  }
  // Chinese data mentioned only in passing by an English outlet is not the release itself.
  if (ctx.lang === "en") topics.delete("macro-cn");
  if (FOREIGN_CONTEXT.test(text) && !CHINA_CONTEXT.test(text)) for (const t of CHINA_TOPICS) topics.delete(t);
  return [...topics];
}
