import { load } from "cheerio";
import { fetchJson, fetchText } from "../http";
import { cleanExcerpt, collapse, stripMarkdown, truncate } from "../text";
import { absoluteUrl } from "../url";
import { zonedTimeToUtc } from "@/lib/time";
import type { RawItem, SourceConfig } from "@/lib/types";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const EN_DATE = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),\s+(20\d\d)\b/;

/** Date-only values are pinned to a plausible publish hour and never placed in the future. */
function dateOnlyIso(year: number, month: number, day: number, hour: number, timeZone: string): string {
  const t = zonedTimeToUtc(year, month, day, hour, 0, timeZone).getTime();
  return new Date(Math.min(t, Date.now())).toISOString();
}

/**
 * anthropic.com/news has no feed. Article links wrap a heading (category links do not), and the
 * nearest ancestor holding only that article also holds its date.
 */
export async function fetchAnthropic(source: SourceConfig): Promise<RawItem[]> {
  const html = await fetchText(source.url, { headers: { Accept: "text/html" } });
  const $ = load(html);
  const bySlug = new Map<string, RawItem>();
  const slugOf = (el: Parameters<typeof $>[0]) => $(el).attr("href")?.split(/[?#]/)[0];
  const articleLinks = $('a[href^="/news/"]').filter((_, a) => $(a).find("h1,h2,h3,h4").length > 0);
  articleLinks.each((_, a) => {
    const href = slugOf(a);
    if (!href || bySlug.has(href)) return;
    let container = $(a);
    let date: RegExpMatchArray | null = null;
    for (let depth = 0; depth < 10 && container.length; depth++) {
      const slugs = new Set(
        container
          .find('a[href^="/news/"]')
          .filter((__, el) => $(el).find("h1,h2,h3,h4").length > 0)
          .map((__, el) => slugOf(el))
          .get(),
      );
      if (slugs.size > 1) break;
      date = (container.find("time").first().text() || container.text()).match(EN_DATE);
      if (date) break;
      container = container.parent();
    }
    if (!date) return;
    const title = collapse($(a).find("h1,h2,h3,h4").first().text());
    if (!title) return;
    const [, mon, d, y] = date;
    bySlug.set(href, {
      title,
      url: absoluteUrl(href, "https://www.anthropic.com"),
      excerpt: cleanExcerpt(container.find("p").first().text()),
      publishedAt: dateOnlyIso(Number(y), MONTHS[mon.slice(0, 3).toLowerCase()], Number(d), 9, "America/Los_Angeles"),
      dateOnly: true,
    });
  });
  if (bySlug.size === 0) throw new Error("页面结构变化，未解析到文章");
  return [...bySlug.values()];
}

interface SeedResponse {
  sub_article_list?: {
    ArticleMeta: { PublishDate: number; ResearchArea?: { ResearchAreaNameZh?: string; ResearchAreaName?: string }[] };
    ArticleSubContentZh?: { Title?: string; Abstract?: string; TitleKey?: string };
    ArticleSubContentEn?: { Title?: string; Abstract?: string; TitleKey?: string };
  }[];
}

export async function fetchSeed(source: SourceConfig): Promise<RawItem[]> {
  const data = await fetchJson<SeedResponse>(source.url);
  const list = data.sub_article_list ?? [];
  if (list.length === 0) throw new Error("接口未返回文章");
  return list.flatMap((a) => {
    const areas = a.ArticleMeta.ResearchArea ?? [];
    if (areas.some((r) => r.ResearchAreaNameZh === "招聘信息" || r.ResearchAreaName === "Recruitment")) return [];
    const zh = a.ArticleSubContentZh ?? {};
    const en = a.ArticleSubContentEn ?? {};
    const slug = en.TitleKey || zh.TitleKey;
    const title = collapse(zh.Title || en.Title || "");
    if (!slug || !title) return [];
    const published = new Date(a.ArticleMeta.PublishDate);
    const local = new Date(published.getTime() + 8 * 3_600_000);
    return [
      {
        title,
        url: `https://seed.bytedance.com/zh/blog/${slug}`,
        excerpt: cleanExcerpt(zh.Abstract || en.Abstract),
        publishedAt: dateOnlyIso(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate(), 10, "Asia/Shanghai"),
        dateOnly: true,
      },
    ];
  });
}

interface QwenResponse {
  data?: {
    articles?: {
      title: string;
      path: string;
      extra?: { date?: string; introduction?: string; description?: string };
    }[];
  };
}

export async function fetchQwen(source: SourceConfig): Promise<RawItem[]> {
  const data = await fetchJson<QwenResponse>(source.url);
  const articles = data.data?.articles ?? [];
  if (articles.length === 0) throw new Error("接口未返回文章");
  return articles
    .filter((a) => a.title && a.path && a.extra?.date)
    .map((a) => ({
      title: collapse(a.title),
      url: `https://qwen.ai/blog?id=${encodeURIComponent(a.path)}`,
      excerpt: cleanExcerpt(stripMarkdown(a.extra?.introduction || a.extra?.description || "")),
      publishedAt: new Date(a.extra!.date!).toISOString(),
    }));
}

/**
 * DeepSeek posts announcements under api-docs.deepseek.com/news/newsYYMMDD. The sitemap lists them;
 * only recent ones are fetched for their Chinese title.
 */
export async function fetchDeepSeek(source: SourceConfig): Promise<RawItem[]> {
  const sitemap = await fetchText(source.url, { headers: { Accept: "application/xml" } });
  const maxAgeMs = 14 * 86_400_000;
  const entries = [...sitemap.matchAll(/<loc>(https:\/\/api-docs\.deepseek\.com\/news\/(news(\d{4,6})))\/?<\/loc>/g)]
    .map(([, , slug, digits]) => {
      const [y, m, d] =
        digits.length === 6
          ? [2000 + Number(digits.slice(0, 2)), Number(digits.slice(2, 4)), Number(digits.slice(4, 6))]
          : [2024, Number(digits.slice(0, 2)), Number(digits.slice(2, 4))];
      return { slug, publishedAt: dateOnlyIso(y, m, d, 10, "Asia/Shanghai") };
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  if (entries.length === 0) throw new Error("站点地图中没有新闻页面");

  const recent = entries.filter((e) => Date.now() - Date.parse(e.publishedAt) < maxAgeMs).slice(0, 4);
  const items: RawItem[] = [];
  for (const entry of recent) {
    const url = `https://api-docs.deepseek.com/zh-cn/news/${entry.slug}`;
    const page = await fetchText(url, { headers: { Accept: "text/html" } });
    const $ = load(page);
    const title = collapse($("article h1, h1").first().text());
    if (!title) continue;
    const firstParagraph = $("article p, .markdown p")
      .map((_, p) => collapse($(p).text()))
      .get()
      .find((t) => t.length > 20);
    items.push({
      title,
      url,
      excerpt: firstParagraph ? truncate(firstParagraph, 280) : undefined,
      publishedAt: entry.publishedAt,
      dateOnly: true,
    });
  }
  return items;
}
