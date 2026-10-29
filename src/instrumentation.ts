export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.STATIC_EXPORT === "1" || process.env.DISABLE_SCHEDULER === "1") return;
  const { startScheduler } = await import("@/lib/pipeline/runner");
  startScheduler();
}
