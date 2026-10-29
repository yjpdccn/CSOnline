"use client";

import { useEffect, useRef, useState } from "react";
import { CATEGORIES } from "@/config/site";
import type { CategoryId } from "@/lib/types";

export type SortMode = "importance" | "latest";

export interface Filters {
  category: CategoryId | "all";
  sources: string[];
  query: string;
  sort: SortMode;
}

export const DEFAULT_FILTERS: Filters = { category: "all", sources: [], query: "", sort: "importance" };

function readFiltersFromUrl(): Filters {
  const p = new URLSearchParams(window.location.search);
  const cat = p.get("cat");
  return {
    category: CATEGORIES.some((c) => c.id === cat) ? (cat as CategoryId) : "all",
    sources: p.get("src")?.split(",").filter(Boolean) ?? [],
    query: p.get("q") ?? "",
    // Importance is the default; old ?sort=hot links land there too.
    sort: p.get("sort") === "latest" ? "latest" : "importance",
  };
}

/**
 * Filter state mirrored into the query string so a filtered view can be bookmarked. The URL is read
 * after mount because the page is prerendered without knowing the query string.
 */
export function useNewsFilters() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const ready = useRef(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from the URL after hydration
    setFilters(readFiltersFromUrl());
    ready.current = true;
  }, []);

  useEffect(() => {
    if (!ready.current) return;
    const p = new URLSearchParams(window.location.search);
    const set = (key: string, value: string) => (value ? p.set(key, value) : p.delete(key));
    set("cat", filters.category === "all" ? "" : filters.category);
    set("src", filters.sources.join(","));
    set("q", filters.query.trim());
    set("sort", filters.sort === "latest" ? "latest" : "");
    const qs = p.toString();
    window.history.replaceState(window.history.state, "", qs ? `?${qs}` : window.location.pathname);
  }, [filters]);

  return [filters, setFilters] as const;
}

/** Current time, only on the client (null during prerender) so relative labels never go stale. */
export function useNow(intervalMs = 60_000): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only clock
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [query]);
  return matches;
}
