import { Info, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { INVEST_SITE } from "@/config/invest";
import { SITE } from "@/config/site";
import { INVEST_STATUS_URL, WORKFLOW_URL } from "@/lib/env";
import type { InvestPageData } from "@/lib/invest/page-data";
import type { StatusNotifications } from "@/lib/invest/status";
import { formatDateTime } from "@/lib/time";
import { AlertsPanel } from "./alerts-panel";
import { CalendarPanel } from "./calendar-panel";
import { DataHealthBanner } from "./data-health";
import { FundGroups } from "./fund-groups";
import { InvestHeader } from "./invest-header";
import { MacroList, MarketCards } from "./market-cards";
import { NewsList } from "./news-list";
import { OverviewCard } from "./overview-card";
import { AiLine, InvestStatusDialog } from "./status-dialog";

function Panel({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border bg-card p-4 ${className ?? ""}`}>
      <h2 className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

const CHANNEL: Record<StatusNotifications["channel"], string> = {
  serverchan: "微信（Server酱）",
  "github-issue": "GitHub issue 留言",
  none: "未配置",
};

function StatusPanel({ run, health }: { run: InvestPageData["run"]; health: InvestPageData["health"] }) {
  if (!run) return <p className="text-sm text-muted-foreground">还没有更新记录。</p>;
  const failed = run.sources.filter((s) => !s.ok);
  const warn = health?.issues.filter((i) => i.severity === "warn") ?? [];
  const minor = health?.issues.filter((i) => i.severity === "minor") ?? [];
  const notify = health?.notifications;
  return (
    <div className="space-y-2 text-sm">
      <p>
        <span className="text-muted-foreground">上次更新：</span>
        {formatDateTime(run.finishedAt)}
      </p>
      <p>
        <span className="text-muted-foreground">数据检查：</span>
        {!health ? "尚未检查" : warn.length ? <span className="text-destructive">{warn.length} 项异常，见页面顶部</span> : "正常"}
      </p>
      {minor.length > 0 && (
        <ul className="space-y-1 text-xs leading-relaxed text-muted-foreground">
          {minor.map((i) => (
            <li key={i.key}>· {i.message}</li>
          ))}
        </ul>
      )}
      <p>
        <span className="text-muted-foreground">来源：</span>
        {run.sources.length - failed.length}/{run.sources.length} 正常
        {failed.length > 0 && <span className="text-destructive">（{failed.map((f) => f.name).join("、")} 失败，沿用上次数据）</span>}
      </p>
      {notify && (
        <p>
          <span className="text-muted-foreground">提醒推送：</span>
          {notify.channel === "github-issue" && notify.issueUrl ? (
            <a href={notify.issueUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              {CHANNEL[notify.channel]}
            </a>
          ) : (
            CHANNEL[notify.channel]
          )}
          {notify.lastSentAt && <span className="text-xs text-muted-foreground">（上次 {formatDateTime(notify.lastSentAt)}）</span>}
        </p>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        <AiLine run={run} />
      </p>
      <InvestStatusDialog run={run}>
        <Button variant="outline" size="sm" className="mt-1 w-full">
          查看全部来源状态
        </Button>
      </InvestStatusDialog>
      {health && (
        <a href={INVEST_STATUS_URL} className="block text-center text-xs text-muted-foreground underline-offset-2 hover:underline">
          status.json：机器可读的数据状态和提醒
        </a>
      )}
    </div>
  );
}

function About() {
  return (
    <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
      <p className="flex gap-2">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>
          {SITE.scheduleLabel}。{INVEST_SITE.disclaimer}
        </span>
      </p>
      <p>场外基金的净值来自天天基金，QDII 基金净值通常晚一到两个交易日公布。场内 ETF 的溢价按收盘价和最新净值计算，净值较旧时按跟踪指数和汇率的变化估算。</p>
    </div>
  );
}

export function InvestApp({ data, error }: { data: InvestPageData | null; error: string | null }) {
  const calendar = data ? <CalendarPanel events={data.calendar.events} nextFomc={data.calendar.nextFomc} /> : null;
  return (
    <div className="flex min-h-screen flex-col">
      <InvestHeader run={data?.run ?? null} health={data?.health ?? null} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-16 sm:px-6 sm:pt-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17.5rem] lg:gap-8">
          <div className="min-w-0 space-y-5">
            {error && (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>数据读取失败</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {data && !data.updatedAt && (
              <Alert>
                <Info />
                <AlertTitle>还没有投资数据</AlertTitle>
                <AlertDescription>
                  {SITE.scheduleLabel}，首次更新完成后这里会显示基金净值、提醒和要闻。
                  {WORKFLOW_URL && (
                    <a href={WORKFLOW_URL} target="_blank" rel="noopener noreferrer" className="ml-1 underline underline-offset-2">
                      在 GitHub Actions 中手动运行
                    </a>
                  )}
                </AlertDescription>
              </Alert>
            )}
            {data && (
              <>
                <DataHealthBanner health={data.health} />
                <AlertsPanel alerts={data.alerts} rules={data.rules} watch={data.watch} premiums={data.premiums} asOf={data.asOf} since={data.health?.since} />
                {data.overview && <OverviewCard overview={data.overview} />}
                <FundGroups groups={data.groups} />
                <MarketCards indices={data.indices} gold={data.gold} />
                <Panel title="财经日历 · 未来两周" className="lg:hidden">
                  {calendar}
                </Panel>
                <NewsList news={data.news} asOf={data.asOf} />
                <div className="space-y-4 lg:hidden">
                  <Panel title="利率与汇率">
                    <MacroList quotes={data.macro} />
                  </Panel>
                  <Panel title="数据状态">
                    <StatusPanel run={data.run} health={data.health} />
                  </Panel>
                </div>
              </>
            )}
          </div>
          {data && (
            <aside className="hidden space-y-4 lg:block">
              <Panel title="财经日历 · 未来两周">{calendar}</Panel>
              <Panel title="利率与汇率">
                <MacroList quotes={data.macro} />
              </Panel>
              <Panel title="数据状态">
                <StatusPanel run={data.run} health={data.health} />
              </Panel>
              <Panel title="关于">
                <About />
              </Panel>
            </aside>
          )}
        </div>
      </main>
      <footer className="border-t py-6">
        <div className="mx-auto max-w-6xl space-y-1 px-4 text-center text-xs leading-relaxed text-muted-foreground sm:px-6">
          <p>{INVEST_SITE.disclaimer}</p>
          <p>
            {INVEST_SITE.name} · 数据来自东方财富、天天基金、蛋卷基金、中证指数、美国财政部、美联储、国家统计局、华尔街见闻、财联社、新浪财经、CNBC、FT 等公开来源 · 时间均为北京时间
          </p>
        </div>
      </footer>
    </div>
  );
}
