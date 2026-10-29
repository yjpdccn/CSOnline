import { load } from "cheerio";
import type { Lang } from "@/lib/types";

export function htmlToText(html: string | undefined | null): string {
  if (!html) return "";
  if (!/[<&]/.test(html)) return collapse(html);
  try {
    return collapse(load(`<div>${html}</div>`).text());
  } catch {
    return collapse(html.replace(/<[^>]+>/g, " "));
  }
}

export function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function truncate(s: string, max: number): string {
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  return chars.slice(0, max - 1).join("").trimEnd() + "…";
}

export function cleanExcerpt(raw: string | undefined | null, max = 280): string | undefined {
  const text = htmlToText(raw)
    .replace(/\[\s*(link|comments)\s*\]/gi, "")
    .replace(/(Read more|Continue reading|阅读全文|查看全文|点击查看原文)\s*(»|›|>|…)?$/i, "")
    .replace(/^The post .+ appeared first on .+\.$/i, "")
    .trim();
  return text.length >= 4 ? truncate(text, max) : undefined;
}

export function stripMarkdown(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>]+/g, "")
    .trim();
}

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/g;

export function detectLang(text: string): Lang {
  const cjk = text.match(CJK)?.length ?? 0;
  const letters = text.replace(/[\s\d\p{P}\p{S}]/gu, "").length || 1;
  return cjk / letters >= 0.2 ? "zh" : "en";
}

/** Lowercased, punctuation-free form used for near-duplicate title detection. */
export function titleFingerprint(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

function bigrams(s: string): Map<string, number> {
  const chars = Array.from(s);
  const grams = new Map<string, number>();
  for (let i = 0; i < chars.length - 1; i++) {
    const g = chars[i] + chars[i + 1];
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  return grams;
}

/** Dice coefficient over character bigrams, 0..1. */
export function titleSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let overlap = 0;
  for (const [g, n] of ga) overlap += Math.min(n, gb.get(g) ?? 0);
  const total = Array.from(a).length - 1 + Array.from(b).length - 1;
  return (2 * overlap) / total;
}

export function parseCount(text: string | undefined | null): number | undefined {
  if (!text) return undefined;
  const m = text.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([kKmM万])?/);
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = m[2]?.toLowerCase();
  if (unit === "k") return Math.round(n * 1_000);
  if (unit === "m") return Math.round(n * 1_000_000);
  if (unit === "万") return Math.round(n * 10_000);
  return Math.round(n);
}
