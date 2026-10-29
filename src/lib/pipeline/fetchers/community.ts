import { load } from "cheerio";
import { fetchFeedItems, feedItemUrl } from "./rss";
import { fetchJson } from "../http";
import { cleanExcerpt, collapse, htmlToText } from "../text";
import type { RawItem, SourceConfig } from "@/lib/types";

interface AlgoliaResponse {
  hits: {
    objectID: string;
    title?: string;
    url?: string | null;
    points?: number;
    num_comments?: number;
    created_at?: string;
    story_text?: string | null;
  }[];
}

/** Stories above a points threshold from the HN Algolia API; the article link wins over the HN thread. */
export async function fetchHackerNews(source: SourceConfig): Promise<RawItem[]> {
  const minPoints = Number(source.options?.minPoints ?? 100);
  const days = Number(source.options?.days ?? 3);
  const since = Math.floor(Date.now() / 1000) - days * 86_400;
  const url = `${source.url}&numericFilters=${encodeURIComponent(`points>=${minPoints},created_at_i>=${since}`)}`;
  const data = await fetchJson<AlgoliaResponse>(url);
  return data.hits.flatMap((hit) => {
    const title = collapse(hit.title ?? "");
    if (!title) return [];
    const thread = `https://news.ycombinator.com/item?id=${hit.objectID}`;
    return [
      {
        title,
        url: hit.url || thread,
        excerpt: cleanExcerpt(hit.story_text),
        publishedAt: hit.created_at,
        discussionUrl: thread,
        metrics: { points: hit.points, comments: hit.num_comments },
      },
    ];
  });
}

const MEDIA_HOSTS = /(^|\.)(redd\.it|reddit\.com|imgur\.com|youtube\.com|youtu\.be|x\.com|twitter\.com)$/i;

/** Reddit Atom feed: link posts point at the external article, self posts at the thread. */
export async function fetchReddit(source: SourceConfig): Promise<RawItem[]> {
  const items = await fetchFeedItems(source);
  return items.flatMap((item) => {
    const permalink = feedItemUrl(item);
    const title = collapse(htmlToText(item.title));
    if (!permalink || !title) return [];
    const html = item.content ?? "";
    const $ = load(html);
    let external: string | undefined;
    $("a").each((_, a) => {
      if ($(a).text().trim() === "[link]") external = $(a).attr("href");
    });
    let externalHost = "";
    try {
      externalHost = external ? new URL(external).hostname : "";
    } catch {
      external = undefined;
    }
    const isLinkPost = !!external && !MEDIA_HOSTS.test(externalHost);
    $("a").filter((_, a) => /^\[(link|comments)\]$/.test($(a).text().trim())).remove();
    const body = $.text().replace(/submitted by\s+\/u\/\S+/i, "");
    return [
      {
        title,
        url: isLinkPost ? external! : permalink,
        discussionUrl: permalink,
        excerpt: cleanExcerpt(body),
        publishedAt: item.isoDate,
      },
    ];
  });
}
