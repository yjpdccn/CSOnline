/**
 * Probe every 投资日报 source (quotes, fund data, valuations, news, calendar) without writing data.
 *   npm run invest:check
 */
import "./load-env";
import { fetchInvest } from "@/lib/invest/refresh";

async function main() {
  const started = Date.now();
  const { results } = await fetchInvest();
  let failures = 0;
  for (const s of results) {
    if (!s.ok) failures++;
    const status = s.ok ? (s.error ? "!" : "✓") : "✗";
    const count = s.total ? `${s.count}/${s.total}` : `${s.count} 条`;
    console.log(`${status} ${s.kind} ${s.name.padEnd(16)} ${String(s.ms).padStart(6)}ms  ${s.ok ? count : ""}${s.error ? `  ${s.error}` : ""}`);
  }
  console.log(`\n${results.length - failures}/${results.length} 个来源可用，用时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (failures) process.exitCode = 1;
}

main();
