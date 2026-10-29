/**
 * Prints the importance ranking of the latest period without changing anything.
 *   npm run rank            # top 30 with the score broken down
 *   npm run rank -- --all   # every card in the period
 */
import "./load-env";
import { SITE } from "@/config/site";
import { rankLatestPeriod } from "@/lib/pipeline/digest";
import { importanceParts, importanceWeight, storyFirstAt } from "@/lib/pipeline/importance";
import { loadStore } from "@/lib/pipeline/store";
import { rankScore } from "@/lib/rank";
import { formatDateTime } from "@/lib/time";

async function main() {
  const store = await loadStore(14);
  const reference = store.meta.lastRun?.startedAt ? new Date(store.meta.lastRun.startedAt) : new Date();
  const cards = [...store.days.values()].flat().filter((i) => !i.dupOf);
  const { hours, period, ranked } = rankLatestPeriod(cards, reference);
  console.log(`参考时间 ${formatDateTime(reference.toISOString())}，过去 ${hours} 小时共 ${period.length} 张卡片（不含 GitHub 仓库 ${ranked.length} 张）\n`);
  const limit = process.argv.includes("--all") ? ranked.length : 30;
  ranked.slice(0, limit).forEach((item, index) => {
    const parts = importanceParts(item);
    const weight = importanceWeight(parts);
    const score = rankScore({ sourceId: item.sourceId, weight, publishedAt: item.publishedAt, firstAt: storyFirstAt(item) }, reference.getTime());
    const breakdown = `权威${parts.authority} 覆盖${parts.coverage} 热度${parts.engagement} 发布${parts.release} 大厂${parts.company}${parts.roundup ? " 汇总×0.6" : ""}`;
    if (index === SITE.topStories) console.log(`---- 以上为默认显示的前 ${SITE.topStories} 条，以下折叠在「更多」 ----`);
    console.log(`${String(index + 1).padStart(2)}. ${score.toFixed(1).padStart(5)} (${weight}) ${item.sourceName}：${item.title.slice(0, 70)}\n      ${breakdown}`);
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
