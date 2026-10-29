/**
 * Re-groups stored items into stories without fetching anything.
 *   npm run dedupe                # print merged stories, change nothing
 *   npm run dedupe -- --write     # save the grouping into data/
 *   npm run dedupe -- --misses    # also list close pairs that were kept apart
 */
import "./load-env";
import { compareItems } from "@/lib/pipeline/cluster";
import { clusterStore } from "@/lib/pipeline/refresh";
import { acquireLock, loadStore, saveStore } from "@/lib/pipeline/store";
import { formatDateTime } from "@/lib/time";

const args = process.argv.slice(2);
const write = args.includes("--write");
const misses = args.includes("--misses");
const WINDOW_DAYS = 30;

async function main() {
  const release = write ? await acquireLock() : async () => {};
  try {
    const store = await loadStore(WINDOW_DAYS);
    const items = [...store.days.values()].flat();
    const { clusters, newlyMerged } = clusterStore(store);
    const merged = clusters.filter((c) => c.members.length).sort((a, b) => b.members.length - a.members.length);
    for (const { primary, members } of merged) {
      console.log(`\n★ ${formatDateTime(primary.publishedAt)}  ${primary.sourceName}：${primary.title}`);
      for (const m of members) {
        const d = compareItems(primary, m, new Set(Object.keys(store.sameEvent)));
        console.log(`   + ${formatDateTime(m.publishedAt)}  ${m.sourceName}：${m.title}  [${d.reason}]`);
      }
    }
    const hidden = merged.reduce((n, c) => n + c.members.length, 0);
    console.log(`\n${items.length} 条 → ${items.length - hidden} 张卡片：${merged.length} 个事件合并了 ${hidden} 条重复报道（本次新合并 ${newlyMerged} 条）`);

    if (misses) {
      console.log("\n相近但未合并：");
      const primaries = clusters.map((c) => c.primary);
      for (let i = 0; i < primaries.length; i++) {
        for (let j = i + 1; j < primaries.length; j++) {
          const d = compareItems(primaries[i], primaries[j]);
          if (d.score >= 0.25 && !d.same && !/时间|汇总/.test(d.reason)) {
            console.log(`  ${d.score.toFixed(2)} [${d.reason}] ${primaries[i].title} ⟷ ${primaries[j].title}`);
          }
        }
      }
    }

    if (write) {
      await saveStore(store);
      console.log(`已写入 ${store.dirtyDays.size} 天的数据`);
    }
  } finally {
    await release();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
