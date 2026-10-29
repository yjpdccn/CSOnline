/**
 * Probe every source without writing data. Use after adding a line to src/config/sources.ts.
 *   npm run sources:check              # enabled sources
 *   npm run sources:check -- --all     # include disabled ones
 *   npm run sources:check -- --only=baoyu
 */
import "./load-env";
import { SOURCES } from "@/config/sources";
import { FETCHERS } from "@/lib/pipeline/fetchers";
import { normalizeError } from "@/lib/pipeline/http";
import { isRelevant } from "@/lib/pipeline/normalize";
import { formatDateTime } from "@/lib/time";

const args = process.argv.slice(2);
const all = args.includes("--all");
const only = args.find((a) => a.startsWith("--only="))?.slice(7).split(",");

async function main() {
  const sources = SOURCES.filter((s) => (only ? only.includes(s.id) : all || s.enabled !== false));
  let failures = 0;
  for (const source of sources) {
    const started = Date.now();
    try {
      const items = await FETCHERS[source.type](source);
      const relevant = items.filter((i) => isRelevant(i, source));
      const newest = items
        .map((i) => i.publishedAt)
        .filter(Boolean)
        .sort()
        .at(-1);
      const sample = relevant[0]?.title ?? items[0]?.title ?? "";
      console.log(
        `✓ ${source.id.padEnd(20)} ${String(items.length).padStart(3)} 条（相关 ${String(relevant.length).padStart(3)}） 最新 ${newest ? formatDateTime(newest) : "—"}  ${Date.now() - started}ms  ${sample.slice(0, 50)}`,
      );
    } catch (err) {
      failures++;
      console.log(`✗ ${source.id.padEnd(20)} ${normalizeError(err).message}  ${Date.now() - started}ms`);
    }
  }
  console.log(`\n${sources.length - failures}/${sources.length} 个来源可用`);
  if (failures) process.exitCode = 1;
}

main();
