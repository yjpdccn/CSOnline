import { Landmark } from "lucide-react";
import type { InvestPageData } from "@/lib/invest/page-data";
import type { IndexView, NewsRef, QuoteView, Valuation } from "@/lib/invest/types";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { fmt, moveClass, percentile, shortDate, signedBp, signedPct } from "./format";
import { Sparkline } from "./sparkline";

function Change({ quote, week = false }: { quote: QuoteView; week?: boolean }) {
  if (quote.yieldSeries) {
    const bp = week ? quote.weekBp : quote.changeBp;
    return <span className={cn("tabular-nums", moveClass(bp))}>{signedBp(bp)}</span>;
  }
  const pct = week ? quote.weekPct : quote.changePct;
  return <span className={cn("tabular-nums", moveClass(pct))}>{signedPct(pct)}</span>;
}

function QuoteLine({ quote, compact = false }: { quote: QuoteView; compact?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
      <span className={cn("font-semibold tabular-nums", compact ? "text-base" : "text-xl")}>
        {fmt(quote.last, quote.decimals)}
        {quote.unit === "%" ? "%" : ""}
      </span>
      {quote.unit && quote.unit !== "%" && <span className="text-xs text-muted-foreground">{quote.unit}</span>}
      <span className="text-sm font-medium">
        <Change quote={quote} />
      </span>
      <span className="text-xs text-muted-foreground">
        近一周 <Change quote={quote} week />
      </span>
    </div>
  );
}

function ValuationLine({ valuation }: { valuation: Valuation }) {
  const parts: string[] = [];
  if (valuation.pe) parts.push(`PE ${valuation.pe.toFixed(1)}${valuation.pePercentile !== undefined ? `（${percentile(valuation.pePercentile)} 分位）` : ""}`);
  if (valuation.pb) parts.push(`PB ${valuation.pb.toFixed(2)}${valuation.pbPercentile !== undefined ? `（${percentile(valuation.pbPercentile)} 分位）` : ""}`);
  const since = valuation.since ? `${valuation.since.slice(0, 4)} 年以来` : "指数历史较短，未算分位";
  return (
    <div className="mt-2 rounded-lg bg-muted/50 px-2.5 py-1.5 text-xs">
      <span className="font-medium tabular-nums">{parts.join(" · ")}</span>
      <span className="ml-1.5 text-muted-foreground">
        {valuation.pePercentile !== undefined || valuation.pbPercentile !== undefined ? `分位按 ${since}，` : `${since}，`}
        {valuation.source} {shortDate(valuation.date)}
      </span>
    </div>
  );
}

function NewsLinks({ news }: { news: NewsRef[] }) {
  if (!news.length) return <p className="mt-2 text-xs text-muted-foreground">近 3 天没有相关要闻。</p>;
  return (
    <ul className="mt-2 space-y-1.5 border-t pt-2">
      {news.map((n) => (
        <li key={n.id} className="text-[13px] leading-snug">
          <a href={n.url} target="_blank" rel="noopener noreferrer" className="hover:underline hover:decoration-foreground/30 hover:underline-offset-2">
            {n.title}
          </a>
          <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
            {n.sourceName} · {formatDateTime(n.publishedAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function IndexCard({ index }: { index: IndexView }) {
  const q = index.quote;
  return (
    <article id={`index-${index.id}`} className="scroll-mt-20 rounded-2xl border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">{index.name}</h3>
        {q && <span className="text-xs text-muted-foreground">{shortDate(q.date)} 收盘</span>}
      </div>
      {q ? (
        <>
          <div className="mt-1">
            <QuoteLine quote={q} />
          </div>
          <Sparkline values={q.history} className="mt-1.5" label={`${index.name}近 ${q.history.length} 个交易日走势`} />
          {q.proxy && <p className="text-[11px] text-muted-foreground">{q.proxy}</p>}
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">暂无行情</p>
      )}
      {index.valuation && <ValuationLine valuation={index.valuation} />}
      <p className="mt-2 text-xs text-muted-foreground">
        跟踪基金：
        {index.funds.map((f, i) => (
          <span key={f.code} title={f.name}>
            {i > 0 && " · "}
            {f.code}
          </span>
        ))}
      </p>
      <NewsLinks news={index.news} />
    </article>
  );
}

function GoldCard({ gold, index }: { gold: InvestPageData["gold"]; index?: IndexView }) {
  return (
    <article id="index-gold" className="scroll-mt-20 rounded-2xl border bg-card p-4 md:col-span-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">黄金</h3>
        {gold.spot && <span className="text-xs text-muted-foreground">{shortDate(gold.spot.date)}</span>}
      </div>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {gold.spot && (
          <div>
            <div className="text-xs text-muted-foreground">现货黄金（伦敦金）</div>
            <QuoteLine quote={gold.spot} />
            <Sparkline values={gold.spot.history} label="现货黄金近 30 个交易日走势" />
          </div>
        )}
        {gold.shanghai && (
          <div>
            <div className="text-xs text-muted-foreground">上海金（上海黄金交易所基准价）</div>
            <QuoteLine quote={gold.shanghai} />
            <Sparkline values={gold.shanghai.history} label="上海金近 30 个交易日走势" />
          </div>
        )}
      </div>
      {index?.quote && (
        <p className="mt-1 text-xs text-muted-foreground">
          黄金联接基金跟踪的 Au99.99：{fmt(index.quote.last, index.quote.decimals)} 元/克 <Change quote={index.quote} />
        </p>
      )}
      {gold.drivers.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {gold.drivers.map((d) => (
            <div key={d.id} className="rounded-lg bg-muted/50 px-2.5 py-1.5">
              <div className="text-[11px] text-muted-foreground">{d.name}</div>
              <div className="text-sm font-semibold tabular-nums">
                {fmt(d.last, d.decimals)}
                {d.unit === "%" ? "%" : ""} <span className="text-xs font-medium">{<Change quote={d} />}</span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {d.source} · {shortDate(d.date)}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3">
        <h4 className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
          <Landmark className="size-3.5" />
          央行购金
        </h4>
        {gold.centralBanks.length ? (
          <NewsLinks news={gold.centralBanks} />
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">近 7 天没有央行购金相关的报道；中国央行的黄金储备随每月 7 日左右的外汇储备数据公布，见右侧日历。</p>
        )}
      </div>
      {index && (
        <>
          <h4 className="mt-3 text-xs font-semibold text-muted-foreground">要闻</h4>
          <NewsLinks news={index.news} />
        </>
      )}
    </article>
  );
}

export function MarketCards({ indices, gold }: { indices: IndexView[]; gold: InvestPageData["gold"] }) {
  const goldIndex = indices.find((i) => i.id === "gold");
  return (
    <section aria-labelledby="markets-title" className="space-y-3">
      <div className="flex items-baseline gap-2 px-1">
        <h2 id="markets-title" className="text-base font-semibold">
          跟踪的指数与黄金
        </h2>
        <span className="text-xs text-muted-foreground">行情来自东方财富，估值来自蛋卷基金和中证指数</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {indices
          .filter((i) => i.id !== "gold")
          .map((index) => (
            <IndexCard key={index.id} index={index} />
          ))}
        <GoldCard gold={gold} index={goldIndex} />
      </div>
    </section>
  );
}

export function MacroList({ quotes }: { quotes: QuoteView[] }) {
  return (
    <ul className="space-y-2 text-sm">
      {quotes.map((q) => (
        <li key={q.id} className="flex items-baseline justify-between gap-2">
          <span className="text-muted-foreground">{q.name}</span>
          <span className="text-right tabular-nums">
            <span className="font-medium">
              {fmt(q.last, q.decimals)}
              {q.unit === "%" ? "%" : ""}
            </span>{" "}
            <span className="text-xs">
              <Change quote={q} />
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
