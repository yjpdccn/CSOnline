import { connection } from "next/server";
import { NewsApp } from "@/components/news/news-app";
import { loadHomeData } from "@/lib/data";
import { IS_STATIC } from "@/lib/env";
import type { HomeData } from "@/lib/view";

export default async function Home() {
  // The static export is rendered once per build; the local server re-reads data/ on every request.
  if (!IS_STATIC) await connection();
  let data: HomeData | null = null;
  let error: string | null = null;
  try {
    data = await loadHomeData();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  return <NewsApp key={data?.lastRun?.finishedAt ?? "empty"} data={data} error={error} />;
}
