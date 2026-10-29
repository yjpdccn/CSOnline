/**
 * Fetch, filter, summarize and persist news into data/.
 *   npm run refresh                     # all enabled sources
 *   npm run refresh -- --no-llm         # skip AI summaries
 *   npm run refresh -- --only=openai,qwen
 */
import "./load-env";
import { ENABLED_SOURCES, SOURCES } from "@/config/sources";
import { runRefresh } from "@/lib/pipeline/refresh";
import { getLlmConfig } from "@/lib/pipeline/llm";

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.slice(7).split(",").filter(Boolean);
const noLlm = args.includes("--no-llm");

async function main() {
  const sources = only ? SOURCES.filter((s) => only.includes(s.id)) : ENABLED_SOURCES;
  if (only && sources.length === 0) {
    console.error(`未找到来源：${only.join(", ")}`);
    process.exit(1);
  }
  const { config, reason } = getLlmConfig();
  console.log(
    noLlm || !config
      ? `AI 摘要：关闭（${noLlm ? "--no-llm" : reason}），使用原文标题与摘要`
      : `AI 摘要：${config.provider} · ${config.model}（每批 ${config.batchSize} 条，每次最多 ${config.maxItems} 条；AI 部分最长 ${Math.round(config.budgetMs / 60_000)} 分钟、${config.maxRequests} 次请求）`,
  );

  let lastStage = "";
  const summary = await runRefresh({
    trigger: process.env.REFRESH_TRIGGER || "cli",
    sources,
    noLlm,
    log: (message) => console.log(`  ${message}`),
    onProgress: (p) => {
      if (p.stage !== lastStage || p.stage === "summarizing") console.log(`· ${p.message}`);
      lastStage = p.stage;
    },
  });

  console.log("");
  for (const s of summary.sources) {
    const status = s.ok ? "✓" : "✗";
    const detail = s.ok ? `抓取 ${s.fetched}，相关 ${s.relevant}，新增 ${s.added}` : s.error;
    console.log(`${status} ${s.name.padEnd(18)} ${String(s.ms).padStart(6)}ms  ${detail}`);
  }
  const failed = summary.sources.filter((s) => !s.ok);
  console.log("");
  console.log(
    `完成：新增 ${summary.totals.added} 条，合并重复 ${summary.totals.merged} 条，${failed.length} 个来源失败，用时 ${(summary.durationMs / 1000).toFixed(1)}s`,
  );
  const llm = summary.llm;
  if (llm.enabled) {
    console.log(
      `AI 摘要：本次新增 ${llm.summarized} 条（${llm.requests} 次请求，${llm.failed} 条未成功），近期已有 ${llm.done ?? "?"} 条，待生成 ${llm.pending ?? "?"} 条；今日要点：${llm.digest === "ai" ? "AI 生成" : "自动摘录"}`,
    );
    if (llm.paused) console.log(`AI 摘要提前结束（${llm.paused}）：${llm.error ?? "已达到本次上限"}`);
  } else if (llm.error) {
    console.log(`AI 摘要提示：${llm.error}`);
  }
  if (!summary.ok) {
    console.error(summary.error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
