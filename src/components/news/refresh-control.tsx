"use client";

import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { IS_STATIC, WORKFLOW_URL } from "@/lib/env";
import type { RefreshStatus } from "@/lib/view";

const POLL_MS = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchStatus(): Promise<RefreshStatus> {
  const res = await fetch("/api/status", { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Local server mode: starts a refresh through the API and follows its progress. */
function LiveRefresh({ onProgress }: { onProgress?: (status: RefreshStatus | null) => void }) {
  const router = useRouter();
  const [status, setStatus] = useState<RefreshStatus | null>(null);
  const [, startTransition] = useTransition();
  const following = useRef(false);
  const mounted = useRef(true);

  const report = useCallback(
    (s: RefreshStatus | null) => {
      setStatus(s);
      onProgress?.(s);
    },
    [onProgress],
  );

  /** Polls until the running refresh finishes, then reloads the server-rendered data. */
  const follow = useCallback(async () => {
    if (following.current) return;
    following.current = true;
    try {
      for (;;) {
        await sleep(POLL_MS);
        if (!mounted.current) return;
        const s = await fetchStatus();
        if (s.running) {
          report(s);
          continue;
        }
        report(null);
        if (s.lastError) {
          toast.error("更新失败", { description: s.lastError });
        } else if (s.lastResult) {
          const failed = s.lastResult.failedSources;
          toast.success(`更新完成，新增 ${s.lastResult.added} 条`, {
            description: failed ? `${failed} 个来源抓取失败，可在“数据状态”中查看` : undefined,
          });
        }
        startTransition(() => router.refresh());
        return;
      }
    } catch {
      report(null);
      toast.error("无法获取更新进度", { description: "请确认开发服务器仍在运行" });
    } finally {
      following.current = false;
    }
  }, [report, router]);

  useEffect(() => {
    mounted.current = true;
    fetchStatus()
      .then((s) => {
        if (mounted.current && s.running) {
          report(s);
          void follow();
        }
      })
      .catch(() => {});
    return () => {
      mounted.current = false;
    };
  }, [follow, report]);

  const start = async () => {
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      const s: RefreshStatus = await res.json();
      if (res.status === 409) toast.info("已有更新任务在运行，正在跟进进度");
      report(s);
      void follow();
    } catch {
      toast.error("无法启动更新", { description: "请确认开发服务器仍在运行" });
    }
  };

  const running = !!status?.running;
  return (
    <Button onClick={start} disabled={running} size="lg" className="min-w-0">
      {running ? <Loader2 className="animate-spin" /> : <RefreshCw />}
      <span className="max-w-[9rem] truncate sm:max-w-[14rem]">{running ? status?.progress?.message ?? "更新中…" : "立即更新"}</span>
    </Button>
  );
}

/** Static GitHub Pages build: there is no server, so link to the workflow's manual run instead. */
function WorkflowLink() {
  if (!WORKFLOW_URL) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild variant="outline" size="lg">
          <a href={WORKFLOW_URL} target="_blank" rel="noopener noreferrer">
            <RefreshCw />
            <span className="hidden sm:inline">手动更新</span>
            <ExternalLink className="size-3 opacity-60" />
          </a>
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        打开 GitHub Actions，点击 “Run workflow” 立即抓取，几分钟后刷新本页即可看到新内容
      </TooltipContent>
    </Tooltip>
  );
}

export function RefreshControl({ onProgress }: { onProgress?: (status: RefreshStatus | null) => void }) {
  return IS_STATIC ? <WorkflowLink /> : <LiveRefresh onProgress={onProgress} />;
}
