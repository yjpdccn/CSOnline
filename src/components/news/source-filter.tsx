"use client";

import { ListFilter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SOURCE_GROUPS } from "@/config/site";
import type { SourceOption } from "@/lib/view";
import { useMediaQuery } from "./hooks";

interface Props {
  sources: SourceOption[];
  counts: Map<string, number>;
  selected: string[];
  onChange: (selected: string[]) => void;
}

function SourceList({ sources, counts, selected, onChange }: Props) {
  const toggle = (id: string, checked: boolean) =>
    onChange(checked ? [...selected, id] : selected.filter((s) => s !== id));
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{selected.length ? `已选 ${selected.length} 个来源` : "显示全部来源"}</span>
        <Button variant="ghost" size="xs" onClick={() => onChange([])} disabled={!selected.length}>
          清除
        </Button>
      </div>
      {SOURCE_GROUPS.map((group) => {
        const items = sources.filter((s) => s.group === group.id);
        if (!items.length) return null;
        const ids = items.map((s) => s.id);
        const allSelected = ids.every((id) => selected.includes(id));
        return (
          <div key={group.id}>
            <div className="mb-1.5 flex items-center justify-between">
              <h4 className="text-xs font-semibold text-muted-foreground">{group.label}</h4>
              <button
                type="button"
                className="text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() =>
                  onChange(allSelected ? selected.filter((id) => !ids.includes(id)) : [...new Set([...selected, ...ids])])
                }
              >
                {allSelected ? "取消本组" : "只看本组"}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {items.map((s) => {
                const count = counts.get(s.id) ?? 0;
                return (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted"
                  >
                    <Checkbox checked={selected.includes(s.id)} onCheckedChange={(v) => toggle(s.id, v === true)} />
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function SourceFilter(props: Props) {
  const desktop = useMediaQuery("(min-width: 640px)");
  const trigger = (
    <Button variant="outline" size="lg" className="shrink-0" aria-label="按来源筛选">
      <ListFilter />
      <span className="hidden sm:inline">来源</span>
      {props.selected.length > 0 && (
        <span className="rounded-full bg-primary px-1.5 text-[11px] leading-4 text-primary-foreground tabular-nums">
          {props.selected.length}
        </span>
      )}
    </Button>
  );

  if (desktop) {
    return (
      <Popover>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent align="end" className="max-h-[70vh] w-[420px] overflow-y-auto p-4">
          <SourceList {...props} />
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader className="pb-0">
          <SheetTitle>按来源筛选</SheetTitle>
          <SheetDescription>勾选后只显示所选来源的资讯</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          <SourceList {...props} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
