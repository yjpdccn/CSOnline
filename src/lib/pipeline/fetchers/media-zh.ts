import { fetchJson } from "../http";
import { cleanExcerpt, collapse } from "../text";
import { zonedTimeToUtc } from "@/lib/time";
import type { RawItem, SourceConfig } from "@/lib/types";

interface JiqizhixinResponse {
  articles?: { title: string; slug: string; publishedAt: string; content?: string }[];
}

/** jiqizhixin.com is a client-rendered app; its article list comes from this JSON endpoint. */
export async function fetchJiqizhixin(source: SourceConfig): Promise<RawItem[]> {
  const data = await fetchJson<JiqizhixinResponse>(source.url);
  const articles = data.articles ?? [];
  if (articles.length === 0) throw new Error("接口未返回文章");
  return articles.flatMap((a) => {
    const m = a.publishedAt?.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
    if (!a.title || !a.slug || !m) return [];
    const publishedAt = zonedTimeToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], "Asia/Shanghai").toISOString();
    return [
      {
        title: collapse(a.title),
        url: `https://www.jiqizhixin.com/articles/${a.slug}`,
        excerpt: cleanExcerpt(a.content),
        publishedAt,
      },
    ];
  });
}

interface Kr36Response {
  code: number;
  data?: {
    itemList?: {
      itemId: number;
      templateMaterial?: {
        widgetTitle?: string;
        widgetContent?: string;
        summary?: string;
        publishTime?: number;
      };
    }[];
  };
}

/** 36kr pages sit behind a JS challenge, but the gateway API used by the site answers plain POSTs. */
export async function fetchKr36(source: SourceConfig): Promise<RawItem[]> {
  const channel = String(source.options?.channel ?? "ai");
  const param =
    channel === "newsflash"
      ? { pageSize: 40, pageEvent: 0, siteId: 1, platformId: 2 }
      : { subnavType: 1, subnavNick: "AI", pageSize: 30, pageEvent: 0, siteId: 1, platformId: 2 };
  const data = await fetchJson<Kr36Response>(source.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://36kr.com", Referer: "https://36kr.com/" },
    body: JSON.stringify({ partner_id: "web", timestamp: Date.now(), param }),
  });
  if (data.code !== 0) throw new Error(`接口返回错误码 ${data.code}`);
  const list = data.data?.itemList ?? [];
  return list.flatMap((item) => {
    const t = item.templateMaterial;
    if (!t?.widgetTitle || !t.publishTime) return [];
    const url =
      channel === "newsflash" ? `https://36kr.com/newsflashes/${item.itemId}` : `https://36kr.com/p/${item.itemId}`;
    return [
      {
        title: collapse(t.widgetTitle),
        url,
        excerpt: cleanExcerpt(t.summary || t.widgetContent),
        publishedAt: new Date(t.publishTime).toISOString(),
      },
    ];
  });
}
