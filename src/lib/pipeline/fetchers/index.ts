import { fetchRss } from "./rss";
import { fetchHackerNews, fetchReddit } from "./community";
import { fetchGithubSearch, fetchGithubTrending } from "./github";
import { fetchHfModels, fetchHfPapers } from "./huggingface";
import { fetchAnthropic, fetchDeepSeek, fetchQwen, fetchSeed } from "./labs";
import { fetchJiqizhixin, fetchKr36 } from "./media-zh";
import type { FetcherType, RawItem, SourceConfig } from "@/lib/types";

export type Fetcher = (source: SourceConfig) => Promise<RawItem[]>;

export const FETCHERS: Record<FetcherType, Fetcher> = {
  rss: fetchRss,
  hackernews: fetchHackerNews,
  reddit: fetchReddit,
  anthropic: fetchAnthropic,
  "github-trending": fetchGithubTrending,
  "github-search": fetchGithubSearch,
  "hf-papers": fetchHfPapers,
  "hf-models": fetchHfModels,
  seed: fetchSeed,
  qwen: fetchQwen,
  deepseek: fetchDeepSeek,
  jiqizhixin: fetchJiqizhixin,
  kr36: fetchKr36,
};
