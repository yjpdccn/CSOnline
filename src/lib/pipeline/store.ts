import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { dayKey, shiftDay } from "@/lib/time";
import type { DayFile, Digest, MetaFile, NewsItem } from "@/lib/types";

export function dataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

const daysDir = () => path.join(dataDir(), "days");
const file = (name: string) => path.join(dataDir(), name);

export interface DayIndexEntry {
  day: string;
  count: number;
}

export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw new Error(`数据文件损坏：${path.relative(process.cwd(), filePath)}（${(err as Error).message}）`);
  }
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await fs.rename(tmp, filePath);
}

export async function readDay(day: string): Promise<DayFile | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return readJson<DayFile | null>(path.join(daysDir(), `${day}.json`), null);
}

export async function readIndex(): Promise<DayIndexEntry[]> {
  const index = await readJson<DayIndexEntry[] | null>(file("index.json"), null);
  if (index) return index;
  // No index yet (e.g. hand-edited data): rebuild it from the day files.
  const entries: DayIndexEntry[] = [];
  let names: string[] = [];
  try {
    names = await fs.readdir(daysDir());
  } catch {
    return [];
  }
  for (const name of names.filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))) {
    const dayFile = await readDay(name.slice(0, 10));
    const count = dayFile ? visibleCount(dayFile.items) : 0;
    if (dayFile && count) entries.push({ day: dayFile.day, count });
  }
  return entries.sort((a, b) => b.day.localeCompare(a.day));
}

/** Reports folded into another item's card are not counted on their own. */
export function visibleCount(items: NewsItem[]): number {
  return items.filter((i) => !i.dupOf).length;
}

export const readMeta = () => readJson<MetaFile>(file("meta.json"), { history: [] });
export const readDigests = () => readJson<Record<string, Digest>>(file("digests.json"), {});

export interface Store {
  days: Map<string, NewsItem[]>;
  seen: Record<string, string>;
  digests: Record<string, Digest>;
  meta: MetaFile;
  index: DayIndexEntry[];
  /** Same-event pairs confirmed by the optional LLM pass (`pairKey` → day it was found). */
  sameEvent: Record<string, string>;
  dirtyDays: Set<string>;
}

/** Loads the recent window used for dedupe and summarization. Older days stay on disk untouched. */
export async function loadStore(windowDays: number, now = new Date()): Promise<Store> {
  const today = dayKey(now);
  const days = new Map<string, NewsItem[]>();
  for (let i = -1; i < windowDays; i++) {
    const day = shiftDay(today, -i);
    const dayFile = await readDay(day);
    if (dayFile) days.set(day, dayFile.items);
  }
  return {
    days,
    seen: await readJson<Record<string, string>>(file("seen.json"), {}),
    digests: await readDigests(),
    meta: await readMeta(),
    index: await readIndex(),
    sameEvent: await readJson<Record<string, string>>(file("same-event.json"), {}),
    dirtyDays: new Set(),
  };
}

const SEEN_RETENTION_DAYS = 180;
const SAME_EVENT_RETENTION_DAYS = 30;
const HISTORY_LENGTH = 60;

export async function saveStore(store: Store, now = new Date()): Promise<void> {
  for (const day of store.dirtyDays) {
    const items = (store.days.get(day) ?? []).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    const dayFile: DayFile = { day, items };
    await writeJson(path.join(daysDir(), `${day}.json`), dayFile);
  }

  const counts = new Map(store.index.map((e) => [e.day, e.count]));
  for (const [day, items] of store.days) {
    const count = visibleCount(items);
    if (count) counts.set(day, count);
    else counts.delete(day);
  }
  store.index = [...counts]
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => b.day.localeCompare(a.day));
  await writeJson(file("index.json"), store.index);

  const sameEventCutoff = shiftDay(dayKey(now), -SAME_EVENT_RETENTION_DAYS);
  const sameEvent = Object.fromEntries(Object.entries(store.sameEvent).filter(([, day]) => day >= sameEventCutoff).sort());
  if (Object.keys(sameEvent).length || (await fs.stat(file("same-event.json")).catch(() => null))) {
    await writeJson(file("same-event.json"), sameEvent);
  }

  const cutoff = shiftDay(dayKey(now), -SEEN_RETENTION_DAYS);
  const seen = Object.fromEntries(
    Object.entries(store.seen)
      .filter(([, day]) => day >= cutoff)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  await writeJson(file("seen.json"), seen);
  await writeJson(file("digests.json"), store.digests);
  store.meta.history = store.meta.history.slice(0, HISTORY_LENGTH);
  await writeJson(file("meta.json"), store.meta);
}

export class LockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LockedError";
  }
}

const LOCK_STALE_MS = 20 * 60_000;

/** Cross-process guard so a CLI run and the dev server's scheduler never write at the same time. */
export async function acquireLock(): Promise<() => Promise<void>> {
  const lockPath = file(".refresh.lock");
  await fs.mkdir(dataDir(), { recursive: true });
  const payload = JSON.stringify({ pid: process.pid, host: os.hostname(), at: new Date().toISOString() });
  try {
    await fs.writeFile(lockPath, payload, { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    const stat = await fs.stat(lockPath).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs < LOCK_STALE_MS) {
      throw new LockedError("已有更新任务在运行");
    }
    await fs.writeFile(lockPath, payload);
  }
  return async () => {
    await fs.rm(lockPath, { force: true });
  };
}
