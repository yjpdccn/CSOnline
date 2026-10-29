import { ExternalLink, Sparkles, Wand2 } from "lucide-react";
import { INVEST_SITE } from "@/config/invest";
import type { InvestPageData } from "@/lib/invest/page-data";
import { formatDateTime } from "@/lib/time";

export function OverviewCard({ overview }: { overview: NonNullable<InvestPageData["overview"]> }) {
  const isAi = overview.mode === "ai";
  return (
    <section aria-labelledby="overview-title" className="relative overflow-hidden rounded-2xl border bg-card p-4 sm:p-5">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-amber-500/[0.07] via-rose-500/[0.03] to-transparent" />
      <div className="relative flex flex-wrap items-center justify-between gap-2">
        <h2 id="overview-title" className="flex items-center gap-2 text-base font-semibold sm:text-lg">
          <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-sm">
            {isAi ? <Sparkles className="size-4" /> : <Wand2 className="size-4" />}
          </span>
          市场概览
        </h2>
        <p className="text-xs text-muted-foreground">
          {isAi ? `AI 撰写${overview.model ? ` · ${overview.model}` : ""}` : "按行情与要闻自动生成"} · {formatDateTime(overview.generatedAt)}
        </p>
      </div>
      <p className="relative mt-3 text-sm leading-relaxed text-foreground/90">{overview.text}</p>
      {overview.points.length > 0 && (
        <ol className="relative mt-3 space-y-2">
          {overview.points.map((point, i) => (
            <li key={i} className="flex gap-3 text-sm leading-relaxed">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground tabular-nums">
                {i + 1}
              </span>
              <div className="min-w-0">
                <span>{point.text}</span>
                {point.refs.slice(0, 2).map((ref) => (
                  <a
                    key={ref.id}
                    href={ref.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={ref.title}
                    className="ml-1.5 inline-flex items-center gap-0.5 align-middle text-xs text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
                  >
                    {ref.sourceName}
                    <ExternalLink className="size-3" />
                  </a>
                ))}
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="relative mt-3 border-t pt-3 text-xs text-muted-foreground">{INVEST_SITE.disclaimer}</p>
    </section>
  );
}
