import { Lock } from "lucide-react";
import Link from "next/link";
import { BASE_PATH, IS_STATIC } from "@/lib/env";
import { cn } from "@/lib/utils";

const PAGES = [
  { id: "ai", href: "/", label: "AI 日报" },
  { id: "invest", href: "/invest", label: "投资日报" },
  { id: "guide", href: "/ktk3ar3rp2f6vv92/", label: "成长指南" },
] as const;

export type PageId = (typeof PAGES)[number]["id"];

/**
 * The guide is a password-protected static page in public/, outside the app router: it needs a plain
 * link with the base path, and the dev server only serves it by its file name.
 */
function guideHref(href: string): string {
  return IS_STATIC ? `${BASE_PATH}${href}` : `${href}index.html`;
}

export function SiteNav({ current, className, wide = false }: { current: PageId; className?: string; wide?: boolean }) {
  return (
    <nav aria-label="切换页面" className={cn("flex shrink-0 items-center gap-0.5 rounded-lg bg-muted/70 p-0.5", className)}>
      {PAGES.map((page) => {
        const active = page.id === current;
        const linkClass = cn(
          "flex items-center justify-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium whitespace-nowrap transition-colors sm:px-2.5 sm:text-sm",
          wide && "flex-1 py-1.5",
          active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
        );
        if (page.id === "guide") {
          return (
            <a key={page.id} href={guideHref(page.href)} rel="nofollow" title="需要密码" className={linkClass}>
              <Lock aria-hidden className="size-3 opacity-70" />
              {page.label}
              <span className="sr-only">（需要密码）</span>
            </a>
          );
        }
        return (
          <Link key={page.id} href={page.href} aria-current={active ? "page" : undefined} className={linkClass}>
            {page.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Phones: the tabs get their own full-width row under the header, which has no room for three. */
export function SiteNavRow({ current }: { current: PageId }) {
  return (
    <div className="px-4 pt-3 sm:hidden">
      <SiteNav current={current} wide />
    </div>
  );
}
