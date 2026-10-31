import { CircleCheck, CircleX } from "lucide-react";
import { formatLimit, statusRank } from "@/lib/invest/alerts";
import type { InvestPageData } from "@/lib/invest/page-data";
import { formatClock } from "@/lib/time";
import { cn } from "@/lib/utils";
import { StaleTag } from "./data-health";
import { fmt, moveClass, shortDate, signedPct } from "./format";

type Fund = InvestPageData["groups"][number]["funds"][number];

function Tag({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "amber" | "sky" }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full px-1.5 text-[11px] font-medium ring-1 ring-inset",
        tone === "amber" && "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300",
        tone === "sky" && "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300",
        tone === "muted" && "bg-muted text-muted-foreground ring-border",
      )}
    >
      {children}
    </span>
  );
}

function FeeLine({ fund }: { fund: Fund }) {
  const fees = fund.fees;
  if (!fees || fees.total === undefined) return null;
  const rule = fund.feeRule;
  const service = fees.service ? `，销售服务费 ${fees.service}%` : "";
  return (
    <span className="inline-flex items-center gap-1" title={`管理费 ${fees.management}% + 托管费 ${fees.custody}%${service}（每年）`}>
      费率 {fees.total.toFixed(2)}%/年{service}
      {rule &&
        (rule.ok ? (
          <CircleCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-label="符合费率规则" />
        ) : (
          <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
            <CircleX className="size-3.5" />
            {rule.kind === "qdii" ? `超过 ${rule.cap}%` : `高于约 ${rule.cap}%`}
          </span>
        ))}
    </span>
  );
}

function StatusLine({ fund }: { fund: Fund }) {
  const status = fund.status;
  if (!status) return null;
  if (fund.etf) {
    // On-exchange ETFs trade on the exchange; only a paused creation (QDII quota) is worth showing.
    return statusRank(status.purchase) === 0 ? <span>一级市场暂停申购</span> : null;
  }
  const rank = statusRank(status.purchase);
  const limit = rank === 1 && typeof status.limit === "number" ? `（${formatLimit(status.limit)}）` : "";
  return (
    <span className={cn(fund.watchLimit && rank === 0 && "text-red-600 dark:text-red-400", fund.watchLimit && rank === 1 && "text-amber-700 dark:text-amber-300")}>
      申购 {status.purchase}
      {limit}
      {status.dca && status.dca !== "支持" && ` · 定投${status.dca}`}
    </span>
  );
}

function IndexLink({ fund }: { fund: Fund }) {
  const link = "underline decoration-muted-foreground/30 underline-offset-2 hover:text-foreground";
  if (fund.tracking) {
    return (
      <a href={`#index-${fund.index}`} className={link}>
        跟踪 {fund.tracking}
      </a>
    );
  }
  // Active and bond funds have no tracked index; their benchmark says what they are measured against.
  if (fund.benchmark) {
    return (
      <span title={fund.benchmark} className="max-w-full truncate sm:max-w-[26rem]">
        业绩基准 {fund.benchmark}
      </span>
    );
  }
  return (
    <a href={`#index-${fund.index}`} className={link}>
      参考 {fund.indexName}
    </a>
  );
}

function FundRow({ fund }: { fund: Fund }) {
  const latest =
    fund.etf && fund.price
      ? { value: fund.price.close, date: fund.price.date, change: fund.price.changePct, label: "收盘价", stale: fund.priceStale }
      : fund.nav
        ? { value: fund.nav.nav, date: fund.nav.date, change: fund.nav.changePct, label: "净值", stale: fund.navStale }
        : null;
  const qdii = fund.feeRule?.kind === "qdii" || /QDII/.test(fund.type ?? "");
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="font-medium">{fund.name}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{fund.code}</span>
          {fund.etf && <Tag tone="sky">场内</Tag>}
          {fund.lof && <Tag tone="sky">LOF</Tag>}
          {qdii && !fund.etf && <Tag>QDII</Tag>}
          {fund.tag && <Tag tone="amber">{fund.tag}</Tag>}
        </div>
        {latest ? (
          <div className="flex items-baseline gap-2.5 tabular-nums">
            <span className="text-base font-semibold">{fmt(latest.value, fund.etf ? 3 : 4)}</span>
            <span className={cn("text-sm font-medium", moveClass(latest.change))}>{signedPct(latest.change)}</span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">暂无数据</span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {latest && (
          <span className="inline-flex items-center gap-1">
            {latest.label} · {shortDate(latest.date)}
            {latest.stale && <StaleTag />}
          </span>
        )}
        {fund.weekPct !== undefined && (
          <span>
            近一周 <span className={cn("font-medium tabular-nums", moveClass(fund.weekPct))}>{signedPct(fund.weekPct)}</span>
          </span>
        )}
        {fund.etf && fund.nav && (
          <span className="inline-flex items-center gap-1 tabular-nums">
            净值 {fmt(fund.nav.nav, 4)}（{shortDate(fund.nav.date)}）{fund.price && fund.navStale && <StaleTag />}
          </span>
        )}
        {fund.lof && fund.price && (
          <span className="inline-flex items-center gap-1 tabular-nums">
            场内价 {fmt(fund.price.close, 3)}（{shortDate(fund.price.date)}）{fund.priceStale && <StaleTag />}
          </span>
        )}
        {fund.premium && (
          <span
            className={cn(
              "font-medium tabular-nums",
              fund.premium.band === "low" && "text-emerald-600 dark:text-emerald-400",
              (fund.premium.band === "mid" || fund.premium.band === "high") && "text-red-600 dark:text-red-400",
              fund.premium.band === "unusual" && "text-amber-600 dark:text-amber-400",
            )}
            title={`收盘价 ${fund.premium.price}，净值 ${fund.premium.nav}（${fund.premium.navDate}）`}
          >
            {fund.premium.value < 0 ? `折价 ${Math.abs(fund.premium.value).toFixed(2)}%` : `溢价 ${fund.premium.value.toFixed(2)}%`}
            {fund.premium.estimated ? "（估算）" : ""}
            {fund.premium.kind === "domestic" && `（${shortDate(fund.premium.navDate)}）`}
          </span>
        )}
        <IndexLink fund={fund} />
        <StatusLine fund={fund} />
        <FeeLine fund={fund} />
      </div>
      {fund.news && (
        <a
          href={fund.news.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 flex min-w-0 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          title={fund.news.title}
        >
          <span className="shrink-0 text-foreground/60">相关</span>
          <span className="min-w-0 truncate">{fund.news.title}</span>
          <span className="shrink-0 tabular-nums">
            {fund.news.sourceName} {formatClock(fund.news.publishedAt)}
          </span>
        </a>
      )}
    </li>
  );
}

export function FundGroups({ groups }: { groups: InvestPageData["groups"] }) {
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.id} aria-labelledby={`group-${group.id}`} className="rounded-2xl border bg-card">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b px-4 py-3">
            <h2 id={`group-${group.id}`} className="text-base font-semibold">
              {group.label}
            </h2>
            <span className="text-xs text-muted-foreground">
              {group.funds.length} 只 · {group.hint}
            </span>
          </div>
          <ul className="divide-y">
            {group.funds.map((fund) => (
              <FundRow key={fund.code} fund={fund} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
