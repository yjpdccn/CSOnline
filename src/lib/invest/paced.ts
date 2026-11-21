import { normalizeError } from "@/lib/pipeline/http";
import type { InvestSourceResult } from "./types";

export interface PacedDeps {
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

/**
 * 天天基金's API and pages drop a few connections in some runs from GitHub's runners, and answer bursts with
 * "514 Frequency Capped". Two at a time, three attempts with jittered exponential backoff, a second pass for
 * what failed, and a stop after a streak of failed attempts so an outage does not hold up the update.
 */
const PACED = { concurrency: 2, attempts: 3, baseDelayMs: 1_000, breaker: 8, secondPassMs: 15_000, secondPassAttempts: 2 };

export interface PacedRead<T> {
  values: Map<string, T>;
  /** Key → error message, in the order the keys first failed. */
  errors: Map<string, string>;
  ms: number;
}

/** Reads each key with one attempt per call to `read`; the retries are paced here. */
export async function readPaced<T>(keys: string[], read: (key: string) => Promise<T>, deps: PacedDeps = {}): Promise<PacedRead<T>> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = deps.random ?? Math.random;
  const values = new Map<string, T>();
  const errors = new Map<string, string>();
  let streak = 0;

  const attempt = async (key: string, tries: number): Promise<T> => {
    let last: unknown;
    for (let k = 0; k < tries; k++) {
      if (streak >= PACED.breaker) throw new Error("接口连续失败，本次先停止读取");
      try {
        const value = await read(key);
        streak = 0;
        return value;
      } catch (err) {
        last = err;
        streak++;
        if (k < tries - 1) await sleep(PACED.baseDelayMs * 2 ** k * (0.5 + random()));
      }
    }
    throw last;
  };
  const readOne = async (key: string, tries: number) => {
    try {
      values.set(key, await attempt(key, tries));
      errors.delete(key);
    } catch (err) {
      errors.set(key, normalizeError(err).message);
    }
  };

  const started = Date.now();
  await mapLimit(keys, PACED.concurrency, (key) => readOne(key, PACED.attempts));
  if (errors.size && streak < PACED.breaker) {
    await sleep(PACED.secondPassMs * (0.5 + random()));
    for (const key of [...errors.keys()]) await readOne(key, PACED.secondPassAttempts);
  }
  return { values, errors, ms: Date.now() - started };
}

/** A source row for a paced read: what is still missing keeps the last good value and goes first next run. */
export function pacedResult(id: string, name: string, total: number, read: PacedRead<unknown>): InvestSourceResult {
  const { errors } = read;
  const result: InvestSourceResult = { id, name, kind: "基金", ok: errors.size < total, count: total - errors.size, total, ms: read.ms };
  if (errors.size) {
    const listed = [...errors].slice(0, 3).map(([key, message]) => `${key}：${message}`);
    result.error = `${listed.join("；")}${errors.size > 3 ? ` 等 ${errors.size} 项` : ""}，下次运行优先重试`;
  }
  return result;
}

/** Oldest first: what earlier runs missed is read while the host is least busy. */
export const oldestFirst = (keys: string[], readAt: (key: string) => string | undefined) => [...keys].sort((a, b) => (readAt(a) ?? "").localeCompare(readAt(b) ?? ""));
