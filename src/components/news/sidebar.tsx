"use client";

import { CodeXml, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CATEGORIES, SITE } from "@/config/site";
import { IS_STATIC, REPO_URL } from "@/lib/env";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { CategoryId } from "@/lib/types";
import type { RunInfo } from "@/lib/view";
import { LlmStatus, StatusDialog } from "./status-dialog";

interface Props {
  category: CategoryId | "all";
  counts: Map<CategoryId | "all", number>;
  onCategory: (c: CategoryId | "all") => void;
  lastRun: RunInfo | null;
  loadedDays: number;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

export function Sidebar({ category, counts, onCategory, lastRun, loadedDays }: Props) {
  const failed = lastRun?.sources.filter((s) => !s.ok) ?? [];
  const rows: { id: CategoryId | "all"; label: string; dot?: string }[] = [
    { id: "all", label: "全部资讯" },
    ...CATEGORIES.map((c) => ({ id: c.id, label: c.label, dot: c.dot })),
  ];
  return (
    <div className="sticky top-[4.5rem] space-y-4">
      <Panel title={`分类 · 最近 ${loadedDays} 天`}>
        <ul className="space-y-0.5">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => onCategory(row.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
                  category === row.id ? "bg-muted font-medium text-foreground" : "text-foreground/80 hover:bg-muted/60",
                )}
              >
                <span className={cn("size-2 rounded-full", row.dot ?? "bg-foreground/70")} />
                <span className="flex-1 text-left">{row.label}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{counts.get(row.id) ?? 0}</span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="数据状态">
        {lastRun ? (
          <div className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">上次更新：</span>
              {formatDateTime(lastRun.finishedAt)}
            </p>
            <p>
              <span className="text-muted-foreground">本次新增：</span>
              {lastRun.totals.added} 条
            </p>
            <p>
              <span className="text-muted-foreground">来源：</span>
              {lastRun.sources.length - failed.length}/{lastRun.sources.length} 正常
              {failed.length > 0 && <span className="text-destructive">（{failed.map((f) => f.name).join("、")} 失败）</span>}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              <span>AI 摘要：</span>
              <LlmStatus run={lastRun} />
            </p>
            <StatusDialog run={lastRun}>
              <Button variant="outline" size="sm" className="mt-1 w-full">
                查看全部来源状态
              </Button>
            </StatusDialog>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">还没有更新记录。</p>
        )}
      </Panel>

      <Panel title="关于">
        <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {SITE.scheduleLabel}。本站只聚合标题与摘要并链接到原文，内容版权归原作者所有。
          </span>
        </p>
        {IS_STATIC && REPO_URL && (
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <CodeXml className="size-3.5" />
            源代码与数据
          </a>
        )}
      </Panel>
    </div>
  );
}
