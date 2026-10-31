"use client";

import { BellRing, CalendarClock, CheckCircle2, Info, TriangleAlert, XCircle } from "lucide-react";
import { FUND_GROUPS, PLAN_GROUPS } from "@/config/invest";
import type { AlertItem, PremiumRow, WatchRow } from "@/lib/invest/page-data";
import type { AlertSeverity, PremiumBand } from "@/lib/invest/types";
import { dayKey, formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useNow } from "../news/hooks";

const SEVERITY: Record<AlertSeverity, { icon: typeof Info; className: string; ring: string }> = {
  bad: { icon: XCircle, className: "text-red-600 dark:text-red-400", ring: "border-red-500/25 bg-red-500/[0.04]" },
  warn: { icon: TriangleAlert, className: "text-amber-600 dark:text-amber-400", ring: "border-amber-500/25 bg-amber-500/[0.05]" },
  good: { icon: CheckCircle2, className: "text-emerald-600 dark:text-emerald-400", ring: "border-emerald-500/25 bg-emerald-500/[0.05]" },
  info: { icon: Info, className: "text-sky-600 dark:text-sky-400", ring: "border-sky-500/25 bg-sky-500/[0.05]" },
};

const ORDER: Record<AlertSeverity, number> = { bad: 0, warn: 1, good: 2, info: 3 };

/** Calendar days from today (Beijing) to `day`. */
function daysUntil(day: string, now: Date): number {
  const [y, m, d] = dayKey(now).split("-").map(Number);
  const [ty, tm, td] = day.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / 86_400_000);
}

function KeyDates({ now }: { now: Date }) {
  const year = Number(dayKey(now).slice(0, 4));
  const pensionDays = daysUntil(`${year}-12-31`, now);
  const taxStart = daysUntil(`${year}-03-01`, now);
  const taxEnd = daysUntil(`${year}-06-30`, now);
  const taxOpen = taxStart <= 0 && taxEnd >= 0;
  const taxYear = taxEnd < 0 ? year + 1 : year;
  const nextTaxStart = taxEnd < 0 ? daysUntil(`${year + 1}-03-01`, now) : taxStart;
  return (
    <ul className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
      <li className="rounded-lg border bg-background/60 px-3 py-2">
        <div className="text-xs text-muted-foreground">个人养老金 · 本年度缴存截止</div>
        <div className="mt-0.5 font-medium">
          {year}年12月31日 <span className="ml-1 text-amber-600 tabular-nums dark:text-amber-400">还有 {pensionDays} 天</span>
        </div>
      </li>
      <li className="rounded-lg border bg-background/60 px-3 py-2">
        <div className="text-xs text-muted-foreground">个税年度汇算（{taxYear - 1} 年度）</div>
        <div className="mt-0.5 font-medium">
          {taxYear}年3月1日—6月30日{" "}
          <span className="ml-1 text-muted-foreground tabular-nums">{taxOpen ? `进行中，还剩 ${taxEnd} 天` : `还有 ${nextTaxStart} 天开始`}</span>
        </div>
      </li>
    </ul>
  );
}

function AlertRow({ alert, now }: { alert: AlertItem; now: Date }) {
  const s = SEVERITY[alert.severity];
  const Icon = s.icon;
  const fresh = alert.at && now.getTime() - Date.parse(alert.at) < 48 * 3600_000;
  return (
    <li className={cn("flex gap-2.5 rounded-xl border px-3 py-2.5", s.ring)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", s.className)} />
      <div className="min-w-0 flex-1 text-sm leading-relaxed">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{alert.title}</span>
          {fresh && <span className="rounded bg-red-500 px-1 text-[10px] leading-4 font-semibold text-white">新</span>}
          {alert.at && <span className="text-xs text-muted-foreground tabular-nums">{formatDateTime(alert.at)} 发现</span>}
        </div>
        <p className="text-muted-foreground">{alert.detail}</p>
      </div>
    </li>
  );
}

const RANK_DOT = ["bg-red-500", "bg-amber-500", "bg-emerald-500"];

const BAND: Record<PremiumBand, { label: string; className: string }> = {
  low: { label: "2% 以内", className: "text-emerald-600 dark:text-emerald-400" },
  mid: { label: "不买", className: "text-amber-600 dark:text-amber-400" },
  high: { label: "不买", className: "text-red-600 dark:text-red-400" },
  normal: { label: "正常", className: "text-foreground" },
  unusual: { label: "偏离较大", className: "text-amber-600 dark:text-amber-400" },
};

const GROUP_LABEL = new Map(FUND_GROUPS.map((g) => [g.id, g.label]));

function WatchList({ rows, showGroup = false }: { rows: WatchRow[]; showGroup?: boolean }) {
  return (
    <ul className="mt-2 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
      {rows.map((row) => (
        <li key={row.code} className="flex min-w-0 items-center gap-2">
          <span className={cn("size-2 shrink-0 rounded-full", RANK_DOT[row.rank] ?? "bg-muted-foreground/40")} />
          {showGroup && <span className="shrink-0 rounded bg-muted px-1 text-[10px] leading-4 text-muted-foreground">{GROUP_LABEL.get(row.group)}</span>}
          <span className="min-w-0 truncate" title={row.name}>
            {row.name}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{row.code}</span>
          <span className="ml-auto shrink-0 text-xs font-medium">{row.status}</span>
        </li>
      ))}
    </ul>
  );
}

function PremiumList({ rows }: { rows: PremiumRow[] }) {
  return (
    <ul className="mt-2 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
      {rows.map(({ code, name, premium }) => {
        const band = BAND[premium.band];
        return (
          <li key={code} className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate" title={name}>
              {name}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{code}</span>
            <span className={cn("ml-auto shrink-0 text-xs font-medium tabular-nums", band.className)}>
              {premium.value > 0 ? "+" : ""}
              {premium.value.toFixed(2)}%{premium.estimated ? "（估算）" : ""} · {band.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function AlertsPanel({ alerts, watch, premiums, asOf }: { alerts: AlertItem[]; watch: WatchRow[]; premiums: PremiumRow[]; asOf: string }) {
  const now = useNow() ?? new Date(asOf);
  const sorted = [...alerts].sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || (b.at ?? "").localeCompare(a.at ?? ""));
  return (
    <section aria-labelledby="alerts-title" className="rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="alerts-title" className="flex items-center gap-2 text-base font-semibold sm:text-lg">
          <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-rose-500 text-white shadow-sm">
            <BellRing className="size-4" />
          </span>
          提醒
        </h2>
        <span className="text-xs text-muted-foreground">每次更新都会与上次的申购额度、费率和溢价比对</span>
      </div>
      <ul className="mt-3 space-y-2">
        {sorted.map((alert) => (
          <AlertRow key={alert.id} alert={alert} now={now} />
        ))}
        {sorted.length === 0 && <li className="rounded-xl border px-3 py-2.5 text-sm text-muted-foreground">目前没有需要处理的事项。</li>}
      </ul>
      {watch.length > 0 && (
        <div className="mt-4 border-t pt-3">
          <h3 className="text-xs font-semibold text-muted-foreground">场外基金申购额度（每次更新检查，状态或日限额变化会出现在上方）</h3>
          <WatchList rows={watch.filter((r) => PLAN_GROUPS.includes(r.group)).sort((a, b) => Number(b.qdii) - Number(a.qdii))} />
          {watch.some((r) => !PLAN_GROUPS.includes(r.group)) && (
            <>
              <h4 className="mt-3 text-[11px] font-medium text-muted-foreground">
                {FUND_GROUPS.filter((g) => !PLAN_GROUPS.includes(g.id))
                  .map((g) => g.label)
                  .join(" · ")}
              </h4>
              <WatchList rows={watch.filter((r) => !PLAN_GROUPS.includes(r.group))} showGroup />
            </>
          )}
        </div>
      )}
      {premiums.length > 0 && (
        <div className="mt-4 border-t pt-3">
          <h3 className="text-xs font-semibold text-muted-foreground">
            场内 ETF / LOF 溢价（QDII 超过 2% 不买，降到 2% 以内提醒；境内的偏离净值 1% 以上才提醒）
          </h3>
          <PremiumList rows={premiums} />
        </div>
      )}
      <div className="mt-4 border-t pt-3">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <CalendarClock className="size-3.5" />
          关键日期
        </h3>
        <KeyDates now={now} />
      </div>
    </section>
  );
}
