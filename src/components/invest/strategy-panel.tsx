"use client";

import { ArrowLeftRight, CircleStop, Compass, TrendingUp } from "lucide-react";
import { INVEST_RULES } from "@/config/invest";
import type { InvestPageData, PageAlert } from "@/lib/invest/page-data";
import type { SuggestionAction } from "@/lib/invest/observations";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useNow } from "../news/hooks";
import { isNew, NewBadge } from "./alerts-panel";

const ACTIONS: { action: SuggestionAction; title: string; icon: typeof Compass; tone: string; ring: string }[] = [
  { action: "replace", title: "可以考虑替换", icon: ArrowLeftRight, tone: "text-sky-600 dark:text-sky-400", ring: "border-sky-500/25 bg-sky-500/[0.04]" },
  { action: "stop", title: "可以考虑停止", icon: CircleStop, tone: "text-red-600 dark:text-red-400", ring: "border-red-500/25 bg-red-500/[0.04]" },
  { action: "increase", title: "可以加大", icon: TrendingUp, tone: "text-emerald-600 dark:text-emerald-400", ring: "border-emerald-500/25 bg-emerald-500/[0.05]" },
];

function Item({ item, now, since }: { item: PageAlert; now: Date; since?: string }) {
  return (
    <li className="text-sm leading-relaxed">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{item.title}</span>
        {isNew(item, now, since) && <NewBadge />}
      </div>
      <p className="text-muted-foreground">{item.detail}</p>
    </li>
  );
}

export function StrategyPanel({ strategy, asOf, since }: { strategy: InvestPageData["strategy"]; asOf: string; since?: string }) {
  const now = useNow() ?? new Date(asOf);
  const { minSaving, minSize, quotaFactor } = INVEST_RULES.alternatives;
  return (
    <section aria-labelledby="strategy-title" className="rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="strategy-title" className="flex items-center gap-2 text-base font-semibold sm:text-lg">
          <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-sky-400 to-indigo-500 text-white shadow-sm">
            <Compass className="size-4" />
          </span>
          策略建议
        </h2>
        <span className="text-xs text-muted-foreground">
          {strategy.checkedAt ? `同类基金比较于 ${formatDateTime(strategy.checkedAt)}，共读取 ${strategy.compared} 只` : "同类基金比较还没有完成"}
        </span>
      </div>
      {strategy.items.length === 0 ? (
        <p className="mt-3 rounded-xl border px-3 py-2.5 text-sm text-muted-foreground">目前没有策略建议：关注的基金没有明显更便宜或额度更高的同类选择，也没有需要停止的信号。</p>
      ) : (
        <div className="mt-3 space-y-3">
          {ACTIONS.map(({ action, title, icon: Icon, tone, ring }) => {
            const items = strategy.items.filter((i) => i.action === action);
            if (!items.length) return null;
            return (
              <div key={action} className={cn("rounded-xl border px-3 py-2.5", ring)}>
                <h3 className={cn("flex items-center gap-1.5 text-sm font-semibold", tone)}>
                  <Icon className="size-4" />
                  {title}
                  <span className="text-xs font-normal text-muted-foreground tabular-nums">{items.length} 条</span>
                </h3>
                <ul className="mt-2 space-y-2.5">
                  {items.map((item) => (
                    <Item key={item.key} item={item} now={now} since={since} />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        替换：每周日比较同一指数（黄金按同样跟踪 Au99.99）的场外基金，只选 A 类（个人养老金看 Y 类）、名称不含「增强」、费率符合规则四、开放申购且日限额不低于现有、规模 {minSize / 1e8}{" "}
        亿元以上的，每年费用（管理费、托管费和销售服务费）低 {minSaving}% 以上才列出，成立不满一年的会注明；C 类份额也和同一基金的 A 类比较。停止：每次更新检查暂停申购或定投、费率上调超过规则、规模低于 5000
        万元、清盘或转型等公告、跟踪误差明显偏大和场内溢价。加大：海外基金恢复申购或额度放开（同类基金的日限额是现有的 {quotaFactor} 倍以上）、场内 QDII ETF 溢价回到 2% 以内。
      </p>
    </section>
  );
}
