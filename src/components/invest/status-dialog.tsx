"use client";

import { CheckCircle2, CircleAlert, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { SITE } from "@/config/site";
import { IS_STATIC, WORKFLOW_URL } from "@/lib/env";
import type { InvestRunSummary } from "@/lib/invest/types";
import { formatDateTime } from "@/lib/time";
import { formatDuration } from "../news/format";

const KINDS = ["行情", "估值", "基金", "新闻", "日历"];

export function AiLine({ run }: { run: InvestRunSummary }) {
  const ai = run.ai;
  if (!ai.enabled) return <span>未启用 AI，概览按行情和要闻自动生成，英文新闻显示原标题。</span>;
  return (
    <span>
      {ai.overview === "ai" ? "市场概览由 AI 撰写" : "这次模型较忙或不可用，市场概览按行情和要闻自动生成"}
      {ai.titles > 0 ? `；本次为 ${ai.titles} 条英文新闻生成了中文标题` : ""}。
    </span>
  );
}

export function InvestStatusDialog({ run, children }: { run: InvestRunSummary | null; children: ReactNode }) {
  const failed = run?.sources.filter((s) => !s.ok) ?? [];
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>数据来源与更新状态</DialogTitle>
          <DialogDescription>
            {SITE.scheduleLabel}（与 AI 日报同一个定时任务）
            {IS_STATIC && WORKFLOW_URL ? (
              <>
                ，也可以在{" "}
                <a href={WORKFLOW_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  GitHub Actions
                </a>{" "}
                中手动运行。
              </>
            ) : (
              "。"
            )}
          </DialogDescription>
        </DialogHeader>
        {!run ? (
          <p className="text-sm text-muted-foreground">还没有更新记录。</p>
        ) : (
          <div className="space-y-5 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              <dt className="text-muted-foreground">上次更新</dt>
              <dd>
                {formatDateTime(run.finishedAt)}（用时 {formatDuration(run.durationMs)}）
              </dd>
              <dt className="text-muted-foreground">新闻</dt>
              <dd>
                抓取 {run.news.fetched} 条，与关注品种相关 {run.news.relevant} 条，新增 {run.news.added} 条
              </dd>
              <dt className="text-muted-foreground">来源</dt>
              <dd>
                {run.sources.length - failed.length}/{run.sources.length} 个正常
                {failed.length > 0 && <span className="text-destructive">，{failed.length} 个失败（保留上次的数据）</span>}
              </dd>
              <dt className="text-muted-foreground">AI</dt>
              <dd>
                <AiLine run={run} />
              </dd>
            </dl>
            {KINDS.map((kind) => {
              const rows = run.sources.filter((s) => s.kind === kind);
              if (!rows.length) return null;
              return (
                <div key={kind}>
                  <h4 className="mb-1.5 text-xs font-semibold text-muted-foreground">{kind}</h4>
                  <ul className="divide-y rounded-lg border">
                    {rows.map((s) => (
                      <li key={s.id} className="flex items-start gap-2 px-3 py-2">
                        {!s.ok ? (
                          <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                        ) : s.error ? (
                          <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
                        ) : (
                          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                            <span className="font-medium">{s.name}</span>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {s.ok ? (s.total ? `${s.count}/${s.total} 项成功` : `${s.count} 条`) : "失败"}
                            </span>
                          </div>
                          {s.error && <p className="mt-0.5 text-xs break-all text-destructive">{s.error}</p>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
