"use client";

import { CheckCircle2, CircleAlert, Sparkles, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { SITE, SOURCE_GROUPS } from "@/config/site";
import { SOURCES } from "@/config/sources";
import { IS_STATIC, WORKFLOW_URL } from "@/lib/env";
import { formatDateTime } from "@/lib/time";
import type { RunInfo } from "@/lib/view";
import { formatDuration, TRIGGER_LABELS } from "./format";

export function LlmStatus({ run }: { run: RunInfo }) {
  const llm = run.llm;
  if (!llm.enabled) {
    return (
      <span>
        未启用（{llm.error ?? "未配置"}），英文资讯显示原标题与摘要
      </span>
    );
  }
  return (
    <span>
      {llm.provider} · {llm.model}：本次生成 {llm.summarized} 条，失败 {llm.failed} 条，
      {llm.merged ? `AI 判断合并重复 ${llm.merged} 条，` : ""}今日要点
      {llm.digest === "ai" ? "由 AI 生成" : "为自动摘录"}
      {llm.error && <span className="block text-amber-600 dark:text-amber-400">提示：{llm.error}</span>}
    </span>
  );
}

export function StatusDialog({ run, children }: { run: RunInfo | null; children: ReactNode }) {
  const failed = run?.sources.filter((s) => !s.ok) ?? [];
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>数据来源与更新状态</DialogTitle>
          <DialogDescription>
            {SITE.scheduleLabel}
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
          <p className="text-sm text-muted-foreground">还没有成功的更新记录。</p>
        ) : (
          <div className="space-y-5 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              <dt className="text-muted-foreground">上次更新</dt>
              <dd>
                {formatDateTime(run.finishedAt)}（{TRIGGER_LABELS[run.trigger] ?? run.trigger}，用时 {formatDuration(run.durationMs)}）
              </dd>
              <dt className="text-muted-foreground">本次结果</dt>
              <dd>
                抓取 {run.totals.fetched} 条，AI 相关 {run.totals.relevant} 条，新增 {run.totals.added} 条，合并重复{" "}
                {run.totals.merged} 条
              </dd>
              <dt className="text-muted-foreground">来源</dt>
              <dd>
                {run.sources.length - failed.length}/{run.sources.length} 个正常
                {failed.length > 0 && <span className="text-destructive">，{failed.length} 个失败</span>}
              </dd>
              <dt className="flex items-start gap-1 text-muted-foreground">
                <Sparkles className="mt-0.5 size-3.5" />
                AI 摘要
              </dt>
              <dd>
                <LlmStatus run={run} />
              </dd>
            </dl>

            {SOURCE_GROUPS.map((group) => {
              const rows = run.sources.filter((s) => (SOURCES.find((c) => c.id === s.id)?.group ?? "community") === group.id);
              if (!rows.length) return null;
              return (
                <div key={group.id}>
                  <h4 className="mb-1.5 text-xs font-semibold text-muted-foreground">{group.label}</h4>
                  <ul className="divide-y rounded-lg border">
                    {rows.map((s) => (
                      <li key={s.id} className="flex items-start gap-2 px-3 py-2">
                        {s.ok ? (
                          s.relevant > 0 ? (
                            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                          ) : (
                            <CircleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                          )
                        ) : (
                          <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                            <span className="font-medium">{s.name}</span>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {s.ok ? `抓取 ${s.fetched} · 近期相关 ${s.relevant} · 新增 ${s.added}` : "抓取失败"}
                            </span>
                          </div>
                          {s.error && <p className="mt-0.5 text-xs break-all text-destructive">{s.error}</p>}
                          {s.ok && s.relevant === 0 && (
                            <p className="mt-0.5 text-xs text-muted-foreground">最近 {SITE.maxItemAgeDays} 天没有新的 AI 相关内容</p>
                          )}
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
