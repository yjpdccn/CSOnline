import Link from "next/link";
import { cn } from "@/lib/utils";

const PAGES = [
  { id: "ai", href: "/", label: "AI 日报" },
  { id: "invest", href: "/invest", label: "投资日报" },
] as const;

export type PageId = (typeof PAGES)[number]["id"];

export function SiteNav({ current }: { current: PageId }) {
  return (
    <nav aria-label="切换页面" className="flex shrink-0 items-center gap-0.5 rounded-lg bg-muted/70 p-0.5">
      {PAGES.map((page) => (
        <Link
          key={page.id}
          href={page.href}
          aria-current={page.id === current ? "page" : undefined}
          className={cn(
            "rounded-md px-2 py-1 text-[13px] font-medium whitespace-nowrap transition-colors sm:px-2.5 sm:text-sm",
            page.id === current ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {page.label}
        </Link>
      ))}
    </nav>
  );
}
