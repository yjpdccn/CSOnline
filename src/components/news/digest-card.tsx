"use client";

import { ChevronDown, ExternalLink, Sparkles, Wand2 } from "lucide-react";
import { useState } from "react";
import { formatDateTime } from "@/lib/time";
import type { LlmRunResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { ClientDigest } from "@/lib/view";

const MOBILE_VISIBLE = 3;

function fallbackNote(llm: LlmRunResult | undefined): string {
  if (!llm?.enabled) {
    return "尚未配置 AI 摘要：英文资讯显示原标题。配置后会自动生成中文标题、一句话摘要和 AI 版今日要点，设置方法见 README。";
  }
  if (llm.notice) return `AI 摘要已暂停：${llm.notice}`;
  return "这次模型较忙，今日要点先按热度摘录，下次更新时会再请 AI 撰写。";
}

export function DigestCard({ digest, llm }: { digest: ClientDigest; llm?: LlmRunResult }) {
  const [expanded, setExpanded] = useState(false);
  const isAi = digest.mode === "ai";
  const hidden = digest.points.length - MOBILE_VISIBLE;

  return (
    <section aria-labelledby="digest-title" className="relative overflow-hidden rounded-2xl border bg-card p-4 sm:p-5">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-violet-500/[0.07] via-sky-500/[0.04] to-transparent"
      />
      <div className="relative flex flex-wrap items-center justify-between gap-2">
        <h2 id="digest-title" className="flex items-center gap-2 text-base font-semibold sm:text-lg">
          <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-sky-500 text-white shadow-sm">
            {isAi ? <Sparkles className="size-4" /> : <Wand2 className="size-4" />}
          </span>
          今日要点
        </h2>
        <p className="text-xs text-muted-foreground">
          {isAi ? `AI 生成${digest.model ? ` · ${digest.model}` : ""}` : "按热度自动摘录"} · {formatDateTime(digest.generatedAt)} 更新 · 覆盖{" "}
          {digest.itemCount} 条
        </p>
      </div>
      <p className="relative mt-3 text-sm leading-relaxed text-foreground/90">{digest.overview}</p>
      <ol className="relative mt-3 space-y-2">
        {digest.points.map((point, i) => (
          <li
            key={i}
            className={cn("flex gap-3 text-sm leading-relaxed", !expanded && i >= MOBILE_VISIBLE && "max-sm:hidden")}
          >
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground tabular-nums">
              {i + 1}
            </span>
            <div className="min-w-0">
              <span>{point.text}</span>
              {point.refs.length > 0 && (
                <span className="ml-1.5 inline-flex flex-wrap gap-x-2 align-middle text-xs text-muted-foreground">
                  {point.refs.slice(0, 2).map((ref) => (
                    <a
                      key={ref.id}
                      href={ref.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={ref.title}
                      className="inline-flex items-center gap-0.5 underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
                    >
                      {ref.sourceName}
                      <ExternalLink className="size-3" />
                    </a>
                  ))}
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
      {hidden > 0 && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="relative mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground sm:hidden"
        >
          展开其余 {hidden} 条
          <ChevronDown className="size-3.5" />
        </button>
      )}
      {!isAi && <p className="relative mt-3 border-t pt-3 text-xs text-muted-foreground">{fallbackNote(llm)}</p>}
    </section>
  );
}
