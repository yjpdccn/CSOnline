import type { CategoryId, SourceGroup } from "@/lib/types";

export const SITE = {
  name: "AI 日报",
  tagline: "大模型 · Agent · AI 工具，每天两次更新",
  description:
    "聚合 OpenAI、Anthropic、Google、字节 Seed、通义千问、DeepSeek、Hugging Face、Hacker News、GitHub、机器之心、量子位等来源的 AI 行业动态。",
  /** Day grouping and all displayed times use this timezone. */
  timezone: "Asia/Shanghai",
  /** Local server mode refresh interval; the GitHub Actions cron lives in .github/workflows/refresh.yml. */
  refreshIntervalHours: 12,
  scheduleLabel: "每天北京时间 08:00、20:00 前后自动更新",
  /** Days rendered on first load; older days load on demand. */
  initialDays: 3,
  /** Stories shown by default in the importance view; the rest fold under 更多. */
  topStories: 20,
  /** Items published earlier than this are ignored when fetching. */
  maxItemAgeDays: 7,
  workflowFile: "refresh.yml",
} as const;

export interface CategoryMeta {
  id: CategoryId;
  label: string;
  short: string;
  /** Tailwind classes for the badge; full class names so Tailwind can see them. */
  badge: string;
  dot: string;
}

export const CATEGORIES: CategoryMeta[] = [
  {
    id: "model",
    label: "模型发布",
    short: "模型",
    badge: "bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-violet-500/20",
    dot: "bg-violet-500",
  },
  {
    id: "agent",
    label: "Agent 与工具",
    short: "Agent",
    badge: "bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-sky-500/20",
    dot: "bg-sky-500",
  },
  {
    id: "multimodal",
    label: "多模态与视频",
    short: "多模态",
    badge: "bg-pink-500/10 text-pink-700 dark:text-pink-300 ring-pink-500/20",
    dot: "bg-pink-500",
  },
  {
    id: "opensource",
    label: "开源项目",
    short: "开源",
    badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20",
    dot: "bg-emerald-500",
  },
  {
    id: "paper",
    label: "论文",
    short: "论文",
    badge: "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/20",
    dot: "bg-amber-500",
  },
  {
    id: "industry",
    label: "产品与行业",
    short: "行业",
    badge: "bg-slate-500/10 text-slate-700 dark:text-slate-300 ring-slate-500/20",
    dot: "bg-slate-500",
  },
];

export const CATEGORY_MAP = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<CategoryId, CategoryMeta>;

export const SOURCE_GROUPS: { id: SourceGroup; label: string }[] = [
  { id: "official", label: "官方博客" },
  { id: "community", label: "社区与开源" },
  { id: "blogger", label: "博主" },
  { id: "media-zh", label: "中文媒体" },
  { id: "media-en", label: "英文媒体" },
];
