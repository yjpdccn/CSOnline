import { createHash } from "node:crypto";
import { load } from "cheerio";
import type { InvestSource } from "@/config/invest-news";
import { fetchJson, fetchText } from "@/lib/pipeline/http";
import { feedItemUrl, parseFeed } from "@/lib/pipeline/fetchers/rss";
import { cleanExcerpt, collapse, htmlToText, truncate } from "@/lib/pipeline/text";
import { zonedTimeToUtc } from "@/lib/time";

/** A report as a feed gives it, before topic tagging and dedupe. */
export interface RawFinanceItem {
  title: string;
  excerpt?: string;
  url: string;
  /** Stable identity when the URL is not, e.g. "wscn:3190133". */
  key?: string;
  publishedAt: string;
  dateOnly?: boolean;
  /** The source's importance mark, 0 = none. */
  flag?: number;
}

const BEIJING = "Asia/Shanghai";

/** "2026-10-29 17:29:07" in Beijing time. */
function beijingTime(text: string | undefined): string | undefined {
  const m = text?.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return m ? zonedTimeToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], BEIJING).toISOString() : undefined;
}

const CLS_DATELINE = /^财联社\d{1,2}月\d{1,2}日电[，,]\s*/;

/**
 * 7x24 items are often one paragraph without a headline: "【标题】正文" gives one; otherwise the
 * first sentence, and the whole text stays as the excerpt.
 */
export function splitFlash(text: string): { title: string; excerpt?: string } {
  const t = collapse(text).replace(CLS_DATELINE, "");
  const bracket = t.match(/^【([^】]{4,90})】\s*(.*)$/);
  if (bracket) return { title: bracket[1].trim(), excerpt: bracket[2] ? truncate(bracket[2].replace(CLS_DATELINE, ""), 280) : undefined };
  if (Array.from(t).length <= 80) return { title: t.replace(/[。.]$/, "") };
  const sentence = t.match(/^(.{8,80}?)[。！？；!?;]/);
  return { title: sentence ? sentence[1] : truncate(t, 70), excerpt: truncate(t, 280) };
}

interface WscnResponse {
  data?: {
    items?: { id: number; title?: string; content_text?: string; display_time: number; score?: number; uri?: string }[];
    next_cursor?: string | number;
  };
}

/** 华尔街见闻 7x24: a channel's live feed, paged by cursor; `minScore` 2 keeps the items it marks important. */
export async function fetchWscn(source: InvestSource): Promise<RawFinanceItem[]> {
  const pages = Number(source.options?.pages ?? 1);
  const minScore = Number(source.options?.minScore ?? 1);
  const out: RawFinanceItem[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < pages; page++) {
    const body = await fetchJson<WscnResponse>(cursor ? `${source.url}&cursor=${cursor}` : source.url);
    const items = body.data?.items ?? [];
    if (!items.length) break;
    for (const item of items) {
      const score = item.score ?? 1;
      if (score < minScore) continue;
      const split = item.title?.trim()
        ? { title: collapse(item.title), excerpt: item.content_text ? truncate(collapse(item.content_text), 280) : undefined }
        : splitFlash(item.content_text ?? "");
      if (!split.title) continue;
      out.push({
        ...split,
        url: item.uri || `https://wallstreetcn.com/livenews/${item.id}`,
        key: `wscn:${item.id}`,
        publishedAt: new Date(item.display_time * 1000).toISOString(),
        flag: Math.max(0, score - 1),
      });
    }
    cursor = body.data?.next_cursor ? String(body.data.next_cursor) : undefined;
    if (!cursor) break;
  }
  if (!out.length && pages > 0) throw new Error("没有返回快讯");
  return out;
}

interface ClsResponse {
  errno?: number | string;
  msg?: string;
  data?: { roll_data?: { id: number; title?: string; brief?: string; content?: string; ctime: number; level?: string }[] };
}

/** 财联社 signs its web API: md5(sha1(sorted query string)). */
export function clsSign(params: Record<string, string>): string {
  const qs = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash("md5").update(createHash("sha1").update(qs).digest("hex")).digest("hex");
}

const CLS_LEVEL: Record<string, number> = { A: 2, B: 1 };

/** 财联社电报; `category: red` is the 加红 list of the telegraph page. */
export async function fetchCls(source: InvestSource): Promise<RawFinanceItem[]> {
  const pages = Number(source.options?.pages ?? 1);
  const out: RawFinanceItem[] = [];
  let lastTime = Math.floor(Date.now() / 1000);
  for (let page = 0; page < pages; page++) {
    const params: Record<string, string> = {
      app: "CailianpressWeb",
      category: String(source.options?.category ?? ""),
      last_time: String(lastTime),
      os: "web",
      refresh_type: "1",
      rn: "50",
      sv: "8.4.6",
    };
    const qs = Object.keys(params)
      .sort()
      .map((k) => `${k}=${encodeURIComponent(params[k])}`)
      .join("&");
    const body = await fetchJson<ClsResponse>(`${source.url}?${qs}&sign=${clsSign(params)}`, {
      headers: { Referer: "https://www.cls.cn/telegraph" },
    });
    if (body.errno !== undefined && String(body.errno) !== "0") throw new Error(`接口返回 ${body.errno} ${body.msg ?? ""}`.trim());
    const rows = body.data?.roll_data ?? [];
    if (!rows.length) break;
    for (const row of rows) {
      const split = row.title?.trim()
        ? { title: collapse(row.title), excerpt: truncate(collapse(row.brief || row.content || "").replace(/^【[^】]*】/, "").replace(CLS_DATELINE, ""), 280) || undefined }
        : splitFlash(row.content || row.brief || "");
      if (!split.title) continue;
      out.push({
        ...split,
        url: `https://www.cls.cn/detail/${row.id}`,
        key: `cls:${row.id}`,
        publishedAt: new Date(row.ctime * 1000).toISOString(),
        flag: CLS_LEVEL[row.level ?? ""] ?? 0,
      });
    }
    lastTime = Math.min(...rows.map((r) => r.ctime));
  }
  if (!out.length) throw new Error("没有返回电报");
  return out;
}

interface EastmoneyFastResponse {
  data?: { fastNewsList?: { code: string; title?: string; summary?: string; showTime?: string; titleColor?: number }[] };
}

/** 东方财富 7x24 by column: 101 焦点, 118 中国央行, 119 全球央行. A red headline (titleColor 3) is its importance mark. */
export async function fetchEastmoney724(source: InvestSource): Promise<RawFinanceItem[]> {
  const column = source.options?.column ?? 102;
  const size = source.options?.pageSize ?? 50;
  const body = await fetchJson<EastmoneyFastResponse>(
    `${source.url}?client=web&biz=web_724&fastColumn=${column}&sortEnd=&pageSize=${size}&req_trace=${Date.now()}`,
    { headers: { Referer: "https://kuaixun.eastmoney.com/" } },
  );
  const list = body.data?.fastNewsList ?? [];
  if (!list.length) throw new Error("没有返回快讯");
  return list.flatMap((item) => {
    const publishedAt = beijingTime(item.showTime);
    const title = collapse(item.title ?? "");
    if (!publishedAt || !title) return [];
    const excerpt = item.summary ? truncate(collapse(item.summary).replace(/^【[^】]*】/, ""), 280) : undefined;
    return [{ title, excerpt: excerpt || undefined, url: `https://finance.eastmoney.com/a/${item.code}.html`, key: `em:${item.code}`, publishedAt, flag: item.titleColor === 3 ? 1 : 0 }];
  });
}

interface SinaFeedResponse {
  result?: {
    data?: {
      feed?: { list?: { id: number; rich_text?: string; create_time?: string; docurl?: string; ext?: string; tag?: { name: string }[] }[] };
    };
  };
}

/** 新浪财经 7x24, one request per tag (1 宏观, 7 央行, 10 A股). */
export async function fetchSina724(source: InvestSource): Promise<RawFinanceItem[]> {
  const tags = String(source.options?.tags ?? "0").split(",");
  const out: RawFinanceItem[] = [];
  for (const tag of tags) {
    const body = await fetchJson<SinaFeedResponse>(
      `${source.url}?page=1&page_size=50&zhibo_id=152&tag_id=${tag.trim()}&dire=f&dpc=1`,
      { headers: { Referer: "https://finance.sina.com.cn/7x24/" } },
    );
    for (const item of body.result?.data?.feed?.list ?? []) {
      const publishedAt = beijingTime(item.create_time);
      if (!publishedAt || !item.rich_text) continue;
      let url = item.docurl || "";
      if (!url && item.ext) {
        try {
          url = (JSON.parse(item.ext) as { docurl?: string }).docurl ?? "";
        } catch {
          // ext is not JSON: fall back to the live page.
        }
      }
      const split = splitFlash(htmlToText(item.rich_text));
      if (!split.title) continue;
      out.push({
        ...split,
        url: url || "https://finance.sina.com.cn/7x24/",
        key: `sina:${item.id}`,
        publishedAt,
        flag: item.tag?.some((t) => t.name === "焦点") ? 1 : 0,
      });
    }
  }
  if (!out.length) throw new Error("没有返回快讯");
  return out;
}

export async function fetchInvestRss(source: InvestSource): Promise<RawFinanceItem[]> {
  const xml = await fetchText(source.url, { headers: { Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.5" } });
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(xml.slice(0, 2000))) throw new Error("返回内容不是 RSS/Atom");
  const match = source.options?.match ? new RegExp(String(source.options.match), "i") : null;
  const items = await parseFeed(xml);
  return items.flatMap((item) => {
    const url = feedItemUrl(item);
    const title = collapse(htmlToText(item.title));
    const time = item.isoDate ?? item.pubDate;
    const publishedAt = time ? new Date(time) : null;
    if (!url || !title || !publishedAt || Number.isNaN(publishedAt.getTime())) return [];
    if (match && !match.test(title)) return [];
    return [{ title, url, excerpt: cleanExcerpt(item.contentSnippet || item.summary || item.content || item.description), publishedAt: publishedAt.toISOString() }];
  });
}

/** 国家统计局「数据发布」list; it only gives dates, so items sit at 10:00 Beijing time. */
export function parseNbsList(html: string, baseUrl: string): RawFinanceItem[] {
  const $ = load(html);
  const out: RawFinanceItem[] = [];
  $(".list-content li").each((_, li) => {
    const a = $(li).find("a[title]").first();
    const title = collapse(a.attr("title") ?? a.text());
    const href = a.attr("href");
    const date = collapse($(li).find("span").last().text()).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!title || !href || !date) return;
    out.push({
      title,
      url: new URL(href, baseUrl).toString(),
      publishedAt: zonedTimeToUtc(+date[1], +date[2], +date[3], 10, 0, BEIJING).toISOString(),
      dateOnly: true,
    });
  });
  if (!out.length) throw new Error("页面中没有发布列表");
  return out;
}

export async function fetchNbs(source: InvestSource): Promise<RawFinanceItem[]> {
  return parseNbsList(await fetchText(source.url), source.url);
}

export const INVEST_FETCHERS: Record<InvestSource["type"], (source: InvestSource) => Promise<RawFinanceItem[]>> = {
  wscn: fetchWscn,
  cls: fetchCls,
  "eastmoney-724": fetchEastmoney724,
  "sina-724": fetchSina724,
  rss: fetchInvestRss,
  nbs: fetchNbs,
};
