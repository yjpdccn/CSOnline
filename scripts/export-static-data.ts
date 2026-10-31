/**
 * Runs after `next build` in static mode: writes every day as JSON into out/data/days/ so the
 * GitHub Pages site can load older days on demand, and publishes the 投资日报's out/invest/status.json.
 */
import "./load-env";
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadClientDay } from "@/lib/data";
import { readInvestStatus } from "@/lib/invest/store";
import { readIndex } from "@/lib/pipeline/store";

async function main() {
  const outDir = path.resolve(process.argv[2] ?? "out");
  try {
    await fs.access(path.join(outDir, "index.html"));
  } catch {
    console.error(`${outDir}/index.html 不存在，请先运行 STATIC_EXPORT=1 next build`);
    process.exit(1);
  }
  const index = await readIndex();
  const daysDir = path.join(outDir, "data", "days");
  await fs.mkdir(daysDir, { recursive: true });
  let written = 0;
  for (const { day } of index) {
    const data = await loadClientDay(day);
    if (!data) continue;
    await fs.writeFile(path.join(daysDir, `${day}.json`), JSON.stringify(data));
    written++;
  }
  await fs.writeFile(path.join(outDir, "data", "index.json"), JSON.stringify(index));
  console.log(`已导出 ${written} 天的数据到 ${path.relative(process.cwd(), daysDir)}`);

  const status = await readInvestStatus();
  if (status) {
    await fs.mkdir(path.join(outDir, "invest"), { recursive: true });
    await fs.writeFile(path.join(outDir, "invest", "status.json"), JSON.stringify(status, null, 2));
    console.log(`已导出投资日报状态到 ${path.relative(process.cwd(), path.join(outDir, "invest", "status.json"))}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
