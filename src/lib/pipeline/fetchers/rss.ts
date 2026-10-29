import Parser from "rss-parser";
import { fetchText } from "../http";
import { cleanExcerpt, collapse, htmlToText } from "../text";
import { zonedTimeToUtc } from "@/lib/time";
import type { RawItem, SourceConfig } from "@/lib/types";

type FeedItem = Parser.Item & {
  comments?: string;
  summary?: string;
  id?: string;
  description?: string;
};

const parser: Parser<object, FeedItem> = new Parser({
  customFields: { item: ["comments", "summary", "id", "description"] },
});

const FEED_ACCEPT = "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5";

export async function parseFeed(xml: string): Promise<FeedItem[]> {
  try {
    return (await parser.parseString(xml)).items;
  } catch {
    // Some feeds ship unescaped ampersands; escape them and retry once.
    const fixed = xml.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/gi, "&amp;");
    return (await parser.parseString(fixed)).items;
  }
}

export async function fetchFeedItems(source: SourceConfig): Promise<FeedItem[]> {
  const xml = await fetchText(source.url, { headers: { Accept: FEED_ACCEPT } });
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(xml.slice(0, 2000))) {
    throw new Error("返回内容不是 RSS/Atom");
  }
  return parseFeed(xml);
}

export function isUtcMidnight(iso: string | undefined): boolean {
  return !!iso && /T00:00:00(\.000)?Z$/.test(iso);
}

export function feedItemUrl(item: FeedItem): string | undefined {
  const link = item.link?.trim();
  if (link) return link;
  const guid = (item.guid ?? item.id)?.trim();
  return guid && /^https?:\/\//.test(guid) ? guid : undefined;
}

function itemDate(item: FeedItem, shiftHours: number): string | undefined {
  const raw = item.isoDate ?? item.pubDate;
  if (!raw) return undefined;
  const t = new Date(raw).getTime();
  if (Number.isNaN(t)) return undefined;
  return new Date(t + shiftHours * 3_600_000).toISOString();
}

/** Publish date from an article page: JSON-LD, Open Graph article meta, or a <time> element. */
export function extractPageDate(html: string, dateOnlyTz: string): { iso: string; dateOnly: boolean } | null {
  const raw =
    html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1] ??
    html.match(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1];
  if (!raw) return null;
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const t = zonedTimeToUtc(+dateOnly[1], +dateOnly[2], +dateOnly[3], 9, 0, dateOnlyTz).getTime();
    return { iso: new Date(Math.min(t, Date.now())).toISOString(), dateOnly: true };
  }
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? null : { iso: new Date(t).toISOString(), dateOnly: false };
}

export async function fetchRss(source: SourceConfig): Promise<RawItem[]> {
  const items = await fetchFeedItems(source);
  // Some feeds label Beijing time as GMT; `dateShiftHours: -8` corrects them.
  const shift = Number(source.options?.dateShiftHours ?? 0);
  const out: RawItem[] = [];
  for (const item of items) {
    const url = feedItemUrl(item);
    const title = collapse(htmlToText(item.title));
    if (!url || !title) continue;
    const publishedAt = itemDate(item, shift);
    out.push({
      title,
      url,
      excerpt: cleanExcerpt(item.contentSnippet || item.summary || item.content || item.description),
      publishedAt,
      dateOnly: isUtcMidnight(publishedAt),
    });
  }
  // Feeds without dates (`fillDates: true`): read the date from the newest few article pages.
  if (source.options?.fillDates) {
    const tz = String(source.options.dateTz ?? "America/Los_Angeles");
    for (const item of out.filter((i) => !i.publishedAt).slice(0, source.limit ?? 5)) {
      try {
        const date = extractPageDate(await fetchText(item.url, { timeoutMs: 10_000, retries: 0 }), tz);
        if (date) {
          item.publishedAt = date.iso;
          item.dateOnly = date.dateOnly;
        }
      } catch {
        // No date found; dropped below.
      }
    }
    return out.filter((i) => i.publishedAt);
  }
  return out;
}
