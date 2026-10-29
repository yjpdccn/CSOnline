import { FolderGit2, Star } from "lucide-react";
import type { ClientItem } from "@/lib/view";
import { formatCount } from "./format";
import { Highlight } from "./highlight";

/** Repos are discovered in batches at refresh time, so they get a dense block instead of flooding the timeline. */
export const REPO_SOURCES = new Set(["github-trending", "github-new"]);

export function RepoList({ items, terms }: { items: ClientItem[]; terms: string[] }) {
  return (
    <section className="rounded-xl border bg-card">
      <h3 className="flex items-center gap-2 border-b px-4 py-2.5 text-sm font-semibold">
        <FolderGit2 className="size-4 text-emerald-600 dark:text-emerald-400" />
        开源项目速览
        <span className="text-xs font-normal text-muted-foreground">GitHub Trending 与新星项目 · {items.length} 个</span>
      </h3>
      <ul className="divide-y">
        {items.map((item) => (
          <li key={item.id} id={`item-${item.id}`} className="group relative px-4 py-2.5 hover:bg-accent/30">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[13px] font-semibold break-all after:absolute after:inset-0 group-hover:underline group-hover:underline-offset-4"
              >
                <Highlight text={item.originalTitle ?? item.title} terms={terms} />
              </a>
              {item.metrics?.stars ? (
                <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                  <Star className="size-3" />
                  {formatCount(item.metrics.stars)}
                  {item.metrics.starsToday ? (
                    <span className="text-emerald-600 dark:text-emerald-400">今日 +{formatCount(item.metrics.starsToday)}</span>
                  ) : null}
                </span>
              ) : null}
              {item.topics?.slice(0, 2).map((t) => (
                <span key={t} className="rounded-md bg-muted px-1.5 text-[11px] text-muted-foreground">
                  {t}
                </span>
              ))}
            </div>
            {(item.originalTitle ? item.title : item.summary) && (
              <p className="mt-0.5 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
                <Highlight text={(item.originalTitle ? item.summary ?? item.title : item.summary) ?? ""} terms={terms} />
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
