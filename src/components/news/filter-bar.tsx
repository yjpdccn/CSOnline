"use client";

import { Clock, Flame, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CATEGORIES } from "@/config/site";
import { cn } from "@/lib/utils";
import type { CategoryId } from "@/lib/types";
import type { SourceOption } from "@/lib/view";
import type { Filters, SortMode } from "./hooks";
import { SourceFilter } from "./source-filter";

interface Props {
  filters: Filters;
  onChange: (next: Filters) => void;
  categoryCounts: Map<CategoryId | "all", number>;
  sourceCounts: Map<string, number>;
  sources: SourceOption[];
}

export function FilterBar({ filters, onChange, categoryCounts, sourceCounts, sources }: Props) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const chips: { id: CategoryId | "all"; label: string; dot?: string }[] = [
    { id: "all", label: "全部" },
    ...CATEGORIES.map((c) => ({ id: c.id, label: c.label, dot: c.dot })),
  ];

  return (
    <div className="sticky top-14 z-20 -mx-4 border-b bg-background/85 px-4 py-3 backdrop-blur-md supports-[backdrop-filter]:bg-background/70 sm:-mx-6 sm:px-6 lg:mx-0 lg:rounded-xl lg:border lg:bg-card/90 lg:px-3 lg:py-2.5">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={filters.query}
            onChange={(e) => set({ query: e.target.value })}
            placeholder="搜索标题、摘要、来源，如 Seedance、MCP、智能体"
            aria-label="搜索资讯"
            className="h-9 bg-card pr-8 pl-9 [&::-webkit-search-cancel-button]:hidden"
          />
          {filters.query && (
            <button
              type="button"
              onClick={() => set({ query: "" })}
              className="absolute top-1/2 right-2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="清除搜索"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <SourceFilter
          sources={sources}
          counts={sourceCounts}
          selected={filters.sources}
          onChange={(selected) => set({ sources: selected })}
        />
        <ToggleGroup
          type="single"
          variant="outline"
          spacing={0}
          value={filters.sort}
          onValueChange={(v) => v && set({ sort: v as SortMode })}
          aria-label="排序方式"
          className="shrink-0"
        >
          <ToggleGroupItem value="latest" aria-label="按时间排序" className="h-9 px-2.5 data-[state=on]:bg-muted">
            <Clock />
            <span className="hidden sm:inline">最新</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="hot" aria-label="按热度排序" className="h-9 px-2.5 data-[state=on]:bg-muted">
            <Flame />
            <span className="hidden sm:inline">热门</span>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* On large screens the sidebar lists categories instead. */}
      <div className="-mx-4 mt-2.5 flex gap-1.5 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:flex-wrap sm:px-0 lg:hidden" role="tablist" aria-label="分类">
        {chips.map((chip) => {
          const active = filters.category === chip.id;
          const count = categoryCounts.get(chip.id) ?? 0;
          return (
            <button
              key={chip.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => set({ category: chip.id })}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors",
                active
                  ? "border-foreground bg-foreground text-background"
                  : "bg-card text-foreground/80 hover:border-foreground/30 hover:text-foreground",
              )}
            >
              {chip.dot && <span className={cn("size-1.5 rounded-full", chip.dot)} />}
              {chip.label}
              <span className={cn("tabular-nums text-xs", active ? "text-background/70" : "text-muted-foreground")}>{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
