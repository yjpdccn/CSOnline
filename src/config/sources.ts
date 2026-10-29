import type { SourceConfig } from "@/lib/types";

/**
 * Every news source lives here; adding one is a single line.
 *
 * - `type: "rss"` covers any RSS/Atom feed. Other types are custom fetchers in src/lib/pipeline/fetchers.
 * - `aiFocused: true` skips the AI keyword filter (the source only covers AI).
 * - `category` forces a category; `defaultCategory` is used when no keyword rule matches.
 * - Set `enabled: false` to keep a verified source around without fetching it.
 *
 * All enabled sources were verified to return data without login on 2026-10-29.
 */
const RSSHUB = process.env.RSSHUB_BASE_URL || "https://rsshub.app";

export const SOURCES: SourceConfig[] = [
  // 官方博客
  { id: "openai", name: "OpenAI", group: "official", type: "rss", url: "https://openai.com/news/rss.xml", aiFocused: true },
  { id: "anthropic", name: "Anthropic", group: "official", type: "anthropic", url: "https://www.anthropic.com/news", aiFocused: true },
  { id: "google-ai", name: "Google AI", group: "official", type: "rss", url: "https://blog.google/technology/ai/rss/", aiFocused: true },
  { id: "deepmind", name: "Google DeepMind", group: "official", type: "rss", url: "https://deepmind.google/blog/rss.xml", aiFocused: true },
  { id: "google-dev", name: "Google 开发者博客", group: "official", type: "rss", url: "https://developers.googleblog.com/feeds/posts/default", limit: 5, options: { fillDates: true }, note: "订阅源不带发布时间，从文章页读取" },
  { id: "google-research", name: "Google Research", group: "official", type: "rss", url: "https://research.google/blog/rss/", defaultCategory: "paper" },
  { id: "meta", name: "Meta", group: "official", type: "rss", url: "https://about.fb.com/news/feed/" },
  { id: "meta-engineering", name: "Meta 工程博客", group: "official", type: "rss", url: "https://engineering.fb.com/feed/" },
  { id: "microsoft-ai", name: "Microsoft AI", group: "official", type: "rss", url: "https://news.microsoft.com/source/topics/ai/feed/", aiFocused: true },
  { id: "microsoft-research", name: "Microsoft Research", group: "official", type: "rss", url: "https://www.microsoft.com/en-us/research/feed/", defaultCategory: "paper" },
  { id: "nvidia", name: "NVIDIA", group: "official", type: "rss", url: "https://blogs.nvidia.com/feed/" },
  { id: "mistral", name: "Mistral AI", group: "official", type: "rss", url: "https://mistral.ai/rss.xml", aiFocused: true },
  { id: "seed", name: "字节跳动 Seed", group: "official", type: "seed", url: "https://seed.bytedance.com/api/get_article_list_v2?article_type=2&count=20&order_desc=true", aiFocused: true, lang: "zh" },
  { id: "qwen", name: "通义千问 Qwen", group: "official", type: "qwen", url: "https://qwen.ai/api/v2/article/retrieval?type=qwen_ai&language=zh-CN", aiFocused: true, lang: "zh" },
  { id: "deepseek", name: "DeepSeek", group: "official", type: "deepseek", url: "https://api-docs.deepseek.com/sitemap.xml", aiFocused: true, lang: "zh", category: "model" },
  { id: "apple-ml", name: "Apple 机器学习研究", group: "official", type: "rss", url: "https://machinelearning.apple.com/rss.xml", aiFocused: true, defaultCategory: "paper" },
  { id: "hf-blog", name: "Hugging Face 博客", group: "official", type: "rss", url: "https://huggingface.co/blog/feed.xml", aiFocused: true },

  // 社区与开源
  { id: "hf-papers", name: "HF 每日论文", group: "community", type: "hf-papers", url: "https://huggingface.co/api/daily_papers?limit=100", aiFocused: true, category: "paper", options: { minUpvotes: 50 } },
  { id: "hf-models", name: "HF 热门模型", group: "community", type: "hf-models", url: "https://huggingface.co/api/models?sort=trendingScore&limit=40", aiFocused: true, limit: 12 },
  { id: "hackernews", name: "Hacker News", group: "community", type: "hackernews", url: "https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=100", options: { minPoints: 100, days: 3 } },
  { id: "github-trending", name: "GitHub Trending", group: "community", type: "github-trending", url: "https://github.com/trending?since=daily", category: "opensource" },
  { id: "github-new", name: "GitHub 新星项目", group: "community", type: "github-search", url: "https://api.github.com/search/repositories", category: "opensource", limit: 15, options: { days: 7, minStars: 200 } },
  { id: "reddit-localllama", name: "r/LocalLLaMA", group: "community", type: "reddit", url: "https://www.reddit.com/r/LocalLLaMA/top/.rss?t=day", aiFocused: true, limit: 15 },

  // 博主
  { id: "baoyu", name: "宝玉", group: "blogger", type: "rss", url: "https://baoyu.io/feed.xml", aiFocused: true },
  { id: "simonw", name: "Simon Willison", group: "blogger", type: "rss", url: "https://simonwillison.net/atom/everything/" },

  // 中文媒体
  { id: "jiqizhixin", name: "机器之心", group: "media-zh", type: "jiqizhixin", url: "https://www.jiqizhixin.com/api/article_library/articles.json?sort=time&page=1&per=30", aiFocused: true, lang: "zh" },
  { id: "qbitai", name: "量子位", group: "media-zh", type: "rss", url: "https://www.qbitai.com/feed", aiFocused: true, lang: "zh" },
  { id: "36kr-ai", name: "36氪 AI", group: "media-zh", type: "kr36", url: "https://gateway.36kr.com/api/mis/nav/ifm/subNav/flow", aiFocused: true, lang: "zh", options: { channel: "ai" } },
  { id: "36kr-flash", name: "36氪快讯", group: "media-zh", type: "kr36", url: "https://gateway.36kr.com/api/mis/nav/newsflash/flow", lang: "zh", options: { channel: "newsflash" } },
  { id: "leiphone", name: "雷峰网", group: "media-zh", type: "rss", url: "https://www.leiphone.com/feed", lang: "zh" },
  { id: "geekpark", name: "极客公园", group: "media-zh", type: "rss", url: "https://www.geekpark.net/rss", lang: "zh" },
  { id: "infoq-cn", name: "InfoQ 中文", group: "media-zh", type: "rss", url: "https://www.infoq.cn/feed", lang: "zh", options: { dateShiftHours: -8 } },
  { id: "ithome", name: "IT之家", group: "media-zh", type: "rss", url: "https://www.ithome.com/rss/", lang: "zh", enabled: false, note: "可用，但消费电子内容多、噪音大" },
  { id: "tmtpost", name: "钛媒体", group: "media-zh", type: "rss", url: "https://www.tmtpost.com/rss.xml", lang: "zh", enabled: false, note: "可用，默认关闭以控制数量" },
  { id: "oschina", name: "开源中国", group: "media-zh", type: "rss", url: "https://www.oschina.net/news/rss", lang: "zh", enabled: false, note: "可用，默认关闭以控制数量" },

  // 英文媒体
  { id: "techcrunch-ai", name: "TechCrunch AI", group: "media-en", type: "rss", url: "https://techcrunch.com/category/artificial-intelligence/feed/", aiFocused: true },
  { id: "verge-ai", name: "The Verge AI", group: "media-en", type: "rss", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", aiFocused: true },
  { id: "the-decoder", name: "The Decoder", group: "media-en", type: "rss", url: "https://the-decoder.com/feed/", aiFocused: true },

  // 需要登录的平台：没有可靠的公共路由（rsshub.app 返回 403），仅在自建 RSSHub（配置 RSSHUB_BASE_URL 及对应 Cookie）后开启
  { id: "weibo-baoyu", name: "宝玉（微博）", group: "blogger", type: "rss", url: `${RSSHUB}/weibo/user/1727858283`, aiFocused: true, lang: "zh", enabled: false, note: "需自建 RSSHub 并配置微博 Cookie" },
  { id: "x-dotey", name: "宝玉（X @dotey）", group: "blogger", type: "rss", url: `${RSSHUB}/twitter/user/dotey`, aiFocused: true, enabled: false, note: "需自建 RSSHub 并配置 X 登录凭据" },
];

export const ENABLED_SOURCES = SOURCES.filter((s) => s.enabled !== false);

export function getSource(id: string): SourceConfig | undefined {
  return SOURCES.find((s) => s.id === id);
}
