import type { Metadata } from "next";
import { connection } from "next/server";
import { InvestApp } from "@/components/invest/invest-app";
import { INVEST_SITE } from "@/config/invest";
import { IS_STATIC } from "@/lib/env";
import { loadInvestPageData, type InvestPageData } from "@/lib/invest/page-data";

export const metadata: Metadata = {
  title: `${INVEST_SITE.name} · 定投基金、指数与黄金`,
  description: "关注的定投基金、个人养老金候选和以后要买的基金：净值、申购额度、费率、场内溢价、跟踪指数估值、黄金与宏观要闻。",
};

export default async function InvestPage() {
  // The static export is rendered once per build; the local server re-reads data/invest/ on every request.
  if (!IS_STATIC) await connection();
  let data: InvestPageData | null = null;
  let error: string | null = null;
  try {
    data = await loadInvestPageData();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  return <InvestApp data={data} error={error} />;
}
