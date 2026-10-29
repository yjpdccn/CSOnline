import type { CalendarEvent } from "@/lib/invest/types";
import { dayKey, formatClock, formatDateTime, formatDay } from "@/lib/time";
import { cn } from "@/lib/utils";

const COUNTRY: Record<string, string> = { 美国: "美", 中国: "中", 欧元区: "欧", 日本: "日", 英国: "英", 沙特阿拉伯: "沙" };

function note(event: CalendarEvent): string | null {
  if (event.country === "中国" && /外汇储备/.test(event.title)) return "同时公布黄金储备";
  return null;
}

export function CalendarPanel({ events, nextFomc }: { events: CalendarEvent[]; nextFomc?: string }) {
  const days = new Map<string, CalendarEvent[]>();
  for (const e of events) days.set(dayKey(e.at), [...(days.get(dayKey(e.at)) ?? []), e]);
  return (
    <div>
      {nextFomc && (
        <p className="mb-3 rounded-lg bg-muted/60 px-2.5 py-2 text-xs leading-relaxed">
          <span className="font-semibold">下次 FOMC 利率决议</span>：{formatDateTime(nextFomc)}（北京时间）
          <span className="block text-muted-foreground">来自美联储官网的会议日程</span>
        </p>
      )}
      {days.size === 0 ? (
        <p className="text-sm text-muted-foreground">未来两周没有重要的数据和会议。</p>
      ) : (
        <ol className="space-y-3">
          {[...days].map(([day, list]) => (
            <li key={day}>
              <div className="mb-1 text-xs font-semibold text-muted-foreground">{formatDay(day)}</div>
              <ul className="space-y-1.5">
                {list.map((e) => (
                  <li key={e.id} className="flex gap-2 text-[13px] leading-snug">
                    <span className="w-10 shrink-0 text-xs text-muted-foreground tabular-nums">{e.dateOnly ? "待定" : formatClock(e.at)}</span>
                    <span
                      className={cn(
                        "mt-px flex size-4 shrink-0 items-center justify-center rounded text-[10px] font-semibold",
                        e.importance >= 4 ? "bg-red-500/15 text-red-700 dark:text-red-300" : "bg-muted text-muted-foreground",
                      )}
                      title={e.country}
                    >
                      {COUNTRY[e.country] ?? e.country.slice(0, 1)}
                    </span>
                    <span className="min-w-0">
                      <span className={cn(e.importance >= 4 && "font-medium")}>
                        {e.country !== "美国" && e.country !== "中国" && !e.title.includes(e.country) ? `${e.country} ` : ""}
                        {e.title}
                      </span>
                      {note(e) && <span className="text-muted-foreground">（{note(e)}）</span>}
                      {(e.previous || e.forecast || e.actual) && (
                        <span className="block text-xs text-muted-foreground tabular-nums">
                          {[e.actual && `公布 ${e.actual}`, e.previous && `前值 ${e.previous}`, e.forecast && `预期 ${e.forecast}`].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">数据与会议日程来自华尔街见闻财经日历，只列美国、中国的重要数据和主要央行议息。</p>
    </div>
  );
}
