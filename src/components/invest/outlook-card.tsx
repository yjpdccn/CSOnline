import { Compass, ExternalLink } from "lucide-react";
import type { OutlookNote } from "@/lib/invest/outlook";
import { cn } from "@/lib/utils";

function Sources({ sources }: { sources: { name: string; url: string }[] }) {
  return (
    <span className="ml-1 inline-flex flex-wrap gap-x-1.5 text-[11px]">
      {sources.map((s, i) => (
        <a key={`${s.url}-${i}`} href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          {s.name}
          <ExternalLink className="size-2.5" />
        </a>
      ))}
    </span>
  );
}

/** The weekly big-picture note: per asset class, valuation, trend, the week's drivers and what it means for 定投. */
export function OutlookCard({ note, stale }: { note: OutlookNote; stale: boolean }) {
  const [, m, d] = note.date.split("-").map(Number);
  return (
    <section aria-labelledby="outlook-title" className="rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="outlook-title" className="flex items-center gap-2 text-base font-semibold sm:text-lg">
          <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-sm">
            <Compass className="size-4" />
          </span>
          {note.title}
        </h2>
        <span className={cn("text-xs", stale ? "font-medium text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
          {m}月{d}日{stale ? " · 已超过一周，新的观点待更新" : " · 每周更新"}
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed">{note.summary}</p>
      {note.asOf && <p className="mt-1 text-xs text-muted-foreground">{note.asOf}</p>}
      <div className="mt-3 divide-y rounded-xl border">
        {note.assets.map((asset) => (
          <details key={asset.id} className="group px-3 py-2.5">
            <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-2 gap-y-0.5 [&::-webkit-details-marker]:hidden">
              <span className="text-sm font-semibold">{asset.name}</span>
              <span className="rounded bg-muted px-1.5 text-[11px] leading-5 text-muted-foreground">{asset.status}</span>
              <span className="ml-auto text-[11px] text-muted-foreground group-open:hidden">展开依据</span>
              <span className="mt-0.5 w-full text-[13px] leading-relaxed text-muted-foreground">{asset.longTerm}</span>
            </summary>
            <dl className="mt-2 grid gap-1.5 text-[13px] leading-relaxed">
              <div>
                <dt className="inline font-medium">估值：</dt>
                <dd className="inline text-muted-foreground">{asset.valuation}</dd>
              </div>
              <div>
                <dt className="inline font-medium">趋势：</dt>
                <dd className="inline text-muted-foreground">{asset.trend}</dd>
              </div>
              <div>
                <dt className="font-medium">本周驱动：</dt>
                <dd>
                  <ul className="mt-0.5 list-disc space-y-1 pl-5 text-muted-foreground">
                    {asset.drivers.map((driver, i) => (
                      <li key={i}>
                        {driver.text}
                        <Sources sources={driver.sources} />
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            </dl>
          </details>
        ))}
      </div>
      {note.watch.length > 0 && (
        <div className="mt-3">
          <h3 className="text-xs font-semibold text-muted-foreground">本周关注</h3>
          <ul className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
            {note.watch.map((w) => (
              <li key={w} className="rounded-full border px-2 py-0.5">
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        本站根据公开数据和报道整理，只讨论各类资产的大方向，不针对任何个人的金额或配置；仅供参考，不构成投资建议。
        {note.dataSources?.length ? (
          <>
            {" "}数据：
            <Sources sources={note.dataSources} />
          </>
        ) : null}
      </p>
    </section>
  );
}
