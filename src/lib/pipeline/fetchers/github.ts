import { load } from "cheerio";
import { fetchJson, fetchText } from "../http";
import { collapse, parseCount, truncate } from "../text";
import type { RawItem, SourceConfig } from "@/lib/types";

export async function fetchGithubTrending(source: SourceConfig): Promise<RawItem[]> {
  const html = await fetchText(source.url, { headers: { Accept: "text/html" } });
  const $ = load(html);
  const now = new Date().toISOString();
  const items: RawItem[] = [];
  $("article.Box-row").each((_, row) => {
    const href = $(row).find("h2 a").attr("href");
    const repo = href?.replace(/^\//, "").trim();
    if (!repo || repo.split("/").length !== 2) return;
    const description = collapse($(row).find("p").first().text());
    const language = collapse($(row).find('[itemprop="programmingLanguage"]').text());
    const stars = parseCount($(row).find('a[href$="/stargazers"]').first().text());
    const todayText = $(row)
      .find("span")
      .filter((__, s) => /stars?\s+(today|this week|this month)/i.test($(s).text()))
      .first()
      .text();
    items.push({
      title: repo,
      url: `https://github.com/${repo}`,
      key: `gh:${repo.toLowerCase()}`,
      excerpt: description ? truncate(description, 280) : undefined,
      publishedAt: now,
      metrics: { stars, starsToday: parseCount(todayText) },
      relevanceText: `${repo.replace(/[-_/]/g, " ")} ${description} ${language}`,
    });
  });
  if (items.length === 0) throw new Error("页面结构变化，未解析到项目");
  return items;
}

interface GithubSearchResponse {
  items: {
    full_name: string;
    html_url: string;
    description: string | null;
    stargazers_count: number;
    language: string | null;
    topics?: string[];
    created_at: string;
  }[];
}

/** Repos created in the last N days with at least M stars, i.e. fast-rising new projects. */
export async function fetchGithubSearch(source: SourceConfig): Promise<RawItem[]> {
  const days = Number(source.options?.days ?? 7);
  const minStars = Number(source.options?.minStars ?? 200);
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const q = encodeURIComponent(`created:>=${since} stars:>=${minStars}`);
  const url = `${source.url}?q=${q}&sort=stars&order=desc&per_page=50`;
  const token = process.env.GITHUB_TOKEN;
  const data = await fetchJson<GithubSearchResponse>(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  return data.items.map((repo) => {
    const description = collapse(repo.description ?? "");
    const topics = repo.topics ?? [];
    return {
      title: repo.full_name,
      url: repo.html_url,
      key: `gh:${repo.full_name.toLowerCase()}`,
      excerpt: description ? truncate(description, 280) : undefined,
      // Creation time keeps a batch of new repos from all landing on the refresh timestamp.
      publishedAt: repo.created_at,
      metrics: { stars: repo.stargazers_count },
      relevanceText: `${repo.full_name.replace(/[-_/]/g, " ")} ${description} ${topics.join(" ")}`,
    };
  });
}
