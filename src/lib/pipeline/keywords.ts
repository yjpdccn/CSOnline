import {
  AI_STRONG,
  AI_WEAK,
  CATEGORY_PRIORITY,
  CATEGORY_RULES,
  TOPICS,
} from "@/config/keywords";
import type { CategoryId } from "@/lib/types";

interface CompiledTerm {
  label: string;
  re: RegExp;
}

const compiled = new Map<string, CompiledTerm>();

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function compileTerm(term: string): CompiledTerm {
  const cached = compiled.get(term);
  if (cached) return cached;

  let t = term;
  let flags = "iu";
  if (t.startsWith("=")) {
    t = t.slice(1);
    flags = "u";
  }
  let suffix = "";
  if (t.endsWith(" *")) {
    t = t.slice(0, -2);
    suffix = "\\s\\d[\\p{L}\\p{N}._-]*";
  } else if (t.endsWith("*")) {
    t = t.slice(0, -1);
    suffix = "[\\p{L}\\p{N}._-]*";
  }
  const body = escapeRegExp(t).replace(/ +/g, "\\s*") + suffix;
  const ascii = /^[\x20-\x7E]*$/.test(t);
  const pattern = ascii ? `(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])` : body;
  const result = { label: t, re: new RegExp(pattern, flags) };
  compiled.set(term, result);
  return result;
}

export function matchTerms(text: string, terms: readonly string[]): string[] {
  if (!text) return [];
  const hits = new Set<string>();
  for (const term of terms) {
    const { label, re } = compileTerm(term);
    if (re.test(text)) hits.add(label.toLowerCase());
  }
  return [...hits];
}

export interface RelevanceResult {
  relevant: boolean;
  strong: string[];
  weak: string[];
}

/**
 * A title with one strong keyword is AI news. A weak keyword in the title needs a second signal,
 * and body text alone needs two strong keywords.
 */
export function checkAiRelevance(title: string, excerpt = ""): RelevanceResult {
  const titleStrong = matchTerms(title, AI_STRONG);
  const titleWeak = matchTerms(title, AI_WEAK);
  const bodyStrong = matchTerms(excerpt, AI_STRONG).filter((t) => !titleStrong.includes(t));
  const relevant =
    titleStrong.length >= 1 ||
    (titleWeak.length >= 1 && titleWeak.length + bodyStrong.length >= 2) ||
    bodyStrong.length >= 2;
  return { relevant, strong: [...titleStrong, ...bodyStrong], weak: titleWeak };
}

export function scoreCategories(title: string, excerpt = ""): Record<CategoryId, number> {
  const scores = Object.fromEntries(CATEGORY_PRIORITY.map((c) => [c, 0])) as Record<CategoryId, number>;
  for (const category of CATEGORY_PRIORITY) {
    const counted = new Set<string>();
    for (const rule of CATEGORY_RULES[category]) {
      for (const term of rule.terms) {
        const { label, re } = compileTerm(term);
        const key = label.toLowerCase();
        if (counted.has(key)) continue;
        if (re.test(title)) {
          scores[category] += rule.weight * 3;
          counted.add(key);
        } else if (excerpt && re.test(excerpt)) {
          scores[category] += rule.weight;
          counted.add(key);
        }
      }
    }
  }
  return scores;
}

const CATEGORY_THRESHOLD = 6;

export function categorize(
  title: string,
  excerpt = "",
  fallback: CategoryId = "industry",
): CategoryId {
  const scores = scoreCategories(title, excerpt);
  let best: CategoryId = fallback;
  let bestScore = CATEGORY_THRESHOLD - 1;
  for (const category of CATEGORY_PRIORITY) {
    if (scores[category] > bestScore) {
      best = category;
      bestScore = scores[category];
    }
  }
  return best;
}

export function matchTopics(text: string, max = 3): string[] {
  const labels: string[] = [];
  for (const topic of TOPICS) {
    if (labels.length >= max) break;
    if (topic.terms.some((term) => compileTerm(term).re.test(text))) labels.push(topic.label);
  }
  return labels;
}
