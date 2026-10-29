import { dayKey, formatClock } from "@/lib/time";
import type { NewsItem } from "@/lib/types";
import { pairKey, type Cluster } from "./cluster";
import { FatalLlmError, type LlmClient } from "./llm";
import { isRoundup, storyFeatures, termOverlap } from "./similarity";
import { translatedTitle, truncate } from "./text";

/** Only recent stories are worth a request; older ones were grouped in earlier runs. */
const LOOKBACK_MS = 48 * 3_600_000;
const MAX_ITEMS = 200;
const NO_LLM_SOURCES = new Set(["github-trending", "github-new", "hf-models", "hf-papers"]);

const DEDUPE_SYSTEM = `你是 AI 资讯编辑，负责找出报道「同一新闻事件」的条目。输入是一组中英文资讯，每条有 id、来源、时间和标题。
把报道同一个具体事件（同一次产品或模型发布、同一份公告、同一起事故、同一笔融资、同一篇论文）的条目分为一组，中文和英文报道可以同组。
不要分到一组：同一公司的不同产品或不同发布；只是话题相近的文章；不同事件的评论文章。拿不准就不要分组。
只输出 JSON：{"groups":[["id","id"]]}，每组至少两个 id，没有就输出 {"groups":[]}。`;

interface DedupeResult {
  groups?: unknown;
}

/**
 * Keeps stories that share a company or a distinctive term with a story from another source in the
 * same window (谷歌 and Google count as the same company), so the request carries only stories that
 * could have a twin.
 */
function withPossibleTwin(items: NewsItem[]): NewsItem[] {
  const features = items.map((i) => storyFeatures(translatedTitle(i) ?? i.title));
  const times = items.map((i) => Date.parse(i.publishedAt));
  const keep = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (items[i].sourceId === items[j].sourceId || Math.abs(times[i] - times[j]) > LOOKBACK_MS) continue;
      const company = [...features[i].terms.keys()].some((t) => t.startsWith("@") && features[j].terms.has(t));
      if (company || termOverlap(features[i], features[j]).specific >= 1) {
        keep.add(i);
        keep.add(j);
      }
    }
  }
  return items.filter((_, i) => keep.has(i));
}

export interface LlmDedupeOutcome {
  /** New same-event pairs (`pairKey`) between different clusters. */
  pairs: string[];
  error?: string;
  fatal?: string;
}

/**
 * Optional: asks the model which recent stories are the same event, mainly to catch Chinese and
 * English reports with no shared names. Returned pairs only add merges, and the heuristic rules
 * (time window, model versions, amounts, same source) still veto them in `applyClusters`.
 */
export async function findSameEventPairs(client: LlmClient, clusters: Cluster[], now: Date): Promise<LlmDedupeOutcome> {
  const clusterOf = new Map<string, number>();
  clusters.forEach((c, index) => {
    clusterOf.set(c.primary.id, index);
    for (const m of c.members) clusterOf.set(m.id, index);
  });
  const recent = clusters
    .map((c) => c.primary)
    .filter((i) => now.getTime() - Date.parse(i.publishedAt) <= LOOKBACK_MS && !NO_LLM_SOURCES.has(i.sourceId) && !isRoundup(i));
  const candidates = withPossibleTwin(recent)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ITEMS)
    .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  if (candidates.length < 2) return { pairs: [] };

  const payload = candidates.map((i) => {
    const zh = translatedTitle(i);
    return {
      id: i.id,
      source: i.sourceName,
      time: `${dayKey(new Date(i.publishedAt)).slice(5)} ${formatClock(i.publishedAt)}`,
      title: truncate(i.title, 120),
      ...(zh ? { zh: truncate(zh, 60) } : {}),
    };
  });
  let result: DedupeResult;
  try {
    result = await client.chatJson<DedupeResult>(
      [
        { role: "system", content: DEDUPE_SYSTEM },
        { role: "user", content: JSON.stringify({ items: payload }) },
      ],
      1500,
    );
  } catch (err) {
    const message = `AI 合并重复失败：${(err as Error).message}`;
    return err instanceof FatalLlmError ? { pairs: [], fatal: message } : { pairs: [], error: message };
  }

  const known = new Set(candidates.map((i) => i.id));
  const pairs = new Set<string>();
  for (const group of Array.isArray(result.groups) ? result.groups : []) {
    if (!Array.isArray(group)) continue;
    const ids = [...new Set(group.map(String).filter((id) => known.has(id)))];
    if (ids.length < 2 || ids.length > 12) continue;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (clusterOf.get(ids[i]) !== clusterOf.get(ids[j])) pairs.add(pairKey(ids[i], ids[j]));
      }
    }
  }
  return { pairs: [...pairs] };
}
