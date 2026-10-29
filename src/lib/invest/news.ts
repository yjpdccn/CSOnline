import { INVEST_SITE, INDICES, type Market } from "@/config/invest";
import {
  EXPLAINER,
  FINANCE_GENERIC,
  IMPORTANCE_SIGNALS,
  INVEST_SOURCES,
  MARKET_TOPICS,
  TOPIC_BONUS,
  type InvestSource,
  type InvestTopic,
} from "@/config/invest-news";
import { applyClusters } from "@/lib/pipeline/cluster";
import { cardSources, storyFirstAt } from "@/lib/pipeline/importance";
import { coverage } from "@/lib/pipeline/score";
import { translatedTitle } from "@/lib/pipeline/text";
import { hashKey, keyFromUrl } from "@/lib/pipeline/url";
import { rankStories } from "@/lib/rank";
import { dayKey } from "@/lib/time";
import type { RawFinanceItem } from "./sources/news";
import { investTopics, isCompanyFiling, isRoundupPost } from "./topics";
import type { InvestNewsItem, NewsRef } from "./types";

/** Reports of one event land within hours; daily recurring headlines ("美股收盘") are a day apart. */
export const INVEST_CLUSTER_WINDOW_MS = 16 * 3_600_000;

const SOURCE_BY_ID = new Map(INVEST_SOURCES.map((s) => [s.id, s]));

export function toInvestItem(raw: RawFinanceItem, source: InvestSource, now: Date): InvestNewsItem | null {
  const title = raw.title.trim();
  if (!title || !raw.url) return null;
  if (isCompanyFiling(title, raw.excerpt) || isRoundupPost(title)) return null;
  const implicit = source.options?.topics ? (String(source.options.topics).split(",") as InvestTopic[]) : undefined;
  const topics = investTopics(title, raw.excerpt, { sourceId: source.id, lang: source.lang, implicit });
  if (!topics.length) return null;
  const parsed = new Date(raw.publishedAt);
  const published = Number.isNaN(parsed.getTime()) || parsed.getTime() > now.getTime() + 10 * 60_000 ? now : parsed;
  const key = raw.key ?? keyFromUrl(raw.url);
  const item: InvestNewsItem = {
    id: hashKey(key),
    key,
    title,
    url: raw.url,
    lang: source.lang,
    sourceId: source.id,
    sourceName: source.name,
    sourceGroup: source.group,
    publishedAt: published.toISOString(),
    firstSeenAt: now.toISOString(),
    day: dayKey(published),
    category: "industry",
    score: 0,
    topics,
  };
  if (raw.excerpt && raw.excerpt !== title) item.excerpt = raw.excerpt;
  if (raw.dateOnly) item.dateOnly = true;
  if (raw.flag) item.flag = raw.flag;
  return item;
}

/** Applies the current topic and filter rules to stored reports, so a rule change also reaches older items. */
function retag(items: InvestNewsItem[]): InvestNewsItem[] {
  return items.flatMap((item) => {
    const source = SOURCE_BY_ID.get(item.sourceId);
    if (!source) return [item];
    if (isCompanyFiling(item.title, item.excerpt) || isRoundupPost(item.title)) return [];
    const implicit = source.options?.topics ? (String(source.options.topics).split(",") as InvestTopic[]) : undefined;
    const topics = investTopics(item.title, item.excerpt, { sourceId: source.id, lang: source.lang, implicit });
    if (!topics.length) return [];
    item.topics = topics;
    return [item];
  });
}

/**
 * Adds fresh reports to the stored ones (same key: keeps the stored item and its AI title), drops reports
 * older than the retention window, and regroups reports of the same event into one card.
 */
export function mergeNews(stored: InvestNewsItem[], fresh: InvestNewsItem[], now: Date): { items: InvestNewsItem[]; added: number } {
  const cutoff = now.getTime() - INVEST_SITE.newsDays * 86_400_000;
  const byKey = new Map(retag(stored.filter((i) => Date.parse(i.publishedAt) >= cutoff)).map((i) => [i.key, i]));
  let added = 0;
  for (const item of fresh) {
    if (Date.parse(item.publishedAt) < cutoff) continue;
    const existing = byKey.get(item.key);
    if (existing) {
      existing.topics = [...new Set([...existing.topics, ...item.topics])];
      if ((item.flag ?? 0) > (existing.flag ?? 0)) existing.flag = item.flag;
      continue;
    }
    byKey.set(item.key, item);
    added++;
  }
  const items = [...byKey.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  for (const item of items) {
    delete item.dupOf;
    delete item.related;
    delete item.story;
  }
  applyClusters(items, undefined, { windowMs: INVEST_CLUSTER_WINDOW_MS, generic: FINANCE_GENERIC });
  return { items, added };
}

const MARKET_OF: Partial<Record<InvestTopic, Market>> = {};
for (const [market, topics] of Object.entries(MARKET_TOPICS) as [Market, InvestTopic[]][]) MARKET_OF[topics[0]] = market;

/** A card's topics and importance mark include those of the reports folded into it. */
export function cardTopics(card: InvestNewsItem, byId: Map<string, InvestNewsItem>): { topics: InvestTopic[]; flag: number } {
  const members = (card.related ?? []).flatMap((r) => (r.id ? [byId.get(r.id)] : [])).filter(Boolean) as InvestNewsItem[];
  const topics = new Set(card.topics);
  let flag = card.flag ?? 0;
  for (const m of members) {
    m.topics.forEach((t) => topics.add(t));
    flag = Math.max(flag, m.flag ?? 0);
  }
  return { topics: [...topics], flag };
}

/** Time-independent importance of a card; `rankStories` adds recency and source diversity. */
export function investWeight(card: InvestNewsItem, topics: InvestTopic[], flag: number): number {
  const sources = cardSources(card);
  const authority = Math.max(...sources.map((id) => SOURCE_BY_ID.get(id)?.authority ?? 10));
  const others = coverage(card);
  const langs = new Set(sources.map((id) => SOURCE_BY_ID.get(id)?.lang ?? card.lang));
  const coverageScore = 14 * Math.log2(1 + others) + (langs.size > 1 ? 4 : 0);
  const headline = [card.title, translatedTitle(card)].filter(Boolean).join(" ");
  const signals = Math.min(16, IMPORTANCE_SIGNALS.reduce((sum, s) => sum + (s.re.test(headline) ? s.bonus : 0), 0));
  const topicBonus = Math.max(0, ...topics.map((t) => TOPIC_BONUS[t] ?? 0));
  const markets = new Set(Object.entries(MARKET_TOPICS).filter(([, ts]) => ts.some((t) => topics.includes(t))).map(([m]) => m));
  const breadth = Math.min(6, 3 * Math.max(0, markets.size - 1));
  const sum = authority + coverageScore + 6 * flag + signals + topicBonus + breadth;
  return Math.round(sum * (EXPLAINER.test(headline) ? 0.6 : 1) * 10) / 10;
}

export interface RankedCard {
  item: InvestNewsItem;
  topics: InvestTopic[];
  weight: number;
}

/** Cards (merged reports hidden) in importance order as of `now`. */
export function rankNews(items: InvestNewsItem[], now: Date): RankedCard[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const cards = items
    .filter((i) => !i.dupOf)
    .map((item) => {
      const { topics, flag } = cardTopics(item, byId);
      return { item, topics, weight: investWeight(item, topics, flag), sourceId: item.sourceId, publishedAt: item.publishedAt, firstAt: storyFirstAt(item) };
    });
  return rankStories(cards, now.getTime()).map(({ item, topics, weight }) => ({ item, topics, weight }));
}

export function newsRef(item: InvestNewsItem): NewsRef {
  return { id: item.id, title: translatedTitle(item) ?? item.title, url: item.url, sourceName: item.sourceName, publishedAt: item.publishedAt };
}

/** Top stories for one market: its own topic first (e.g. 美股 news before Fed news on the 纳指 card). */
export function marketNews(ranked: RankedCard[], market: Market, limit = 3, sinceMs?: number): RankedCard[] {
  const topics = MARKET_TOPICS[market];
  const own = topics[0];
  const pool = ranked.filter((c) => c.topics.some((t) => topics.includes(t)) && (!sinceMs || Date.parse(c.item.publishedAt) >= sinceMs));
  const first = pool.filter((c) => c.topics.includes(own));
  const rest = pool.filter((c) => !c.topics.includes(own));
  // Keep one slot for the biggest story from the drivers (central bank, data) when there is one.
  const reserved = Math.max(1, limit - 1);
  return [...first.slice(0, reserved), ...rest, ...first.slice(reserved)].slice(0, limit);
}

export const MARKETS_IN_USE = [...new Set(INDICES.map((i) => i.market))];
