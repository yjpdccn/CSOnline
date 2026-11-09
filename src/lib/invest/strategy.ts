import { FUNDS, INDICES, INVEST_RULES } from "@/config/invest";
import { normalizeError } from "@/lib/pipeline/http";
import { collapse } from "@/lib/pipeline/text";
import { dayKey } from "@/lib/time";
import { shareClass, type FeePage, type FundNotice, type ProfilePage, type UniverseFund } from "./sources/funds";
import type { FundFees, FundStatus, FundsFile, InvestSourceResult } from "./types";

/** Another off-exchange fund on a tracked index (or the A class of a tracked C/E fund), from the weekly scan. */
export interface PeerFund {
  code: string;
  name: string;
  /** Share class letter, "" for a single-class fund. */
  cls: string;
  qdii: boolean;
  fees: FundFees;
  established?: string;
  /** Net assets across all share classes, yuan, and the report date. */
  size?: number;
  sizeDate?: string;
  status?: FundStatus & { asOf: string };
}

/** What the weekly scan learns about a tracked fund. */
export interface TrackedMeta {
  /** Net assets across all share classes, yuan. */
  size?: number;
  sizeDate?: string;
  established?: string;
  /** Annualized tracking error, percent. */
  trackingError?: number;
}

/** data/invest/strategy.json: the weekly comparison and the announcements read every run. */
export interface StrategyFile {
  checkedAt?: string;
  /** Candidates by 跟踪标的 name; `same:<code>` holds the A class of a tracked C/E fund without an index. */
  peers: Record<string, PeerFund[]>;
  tracked: Record<string, TrackedMeta>;
  /** Funds read in the last scan. */
  compared?: number;
  /** Material announcements of tracked funds (清盘, 转型, 合并, new benchmark), read every run. */
  notices: Record<string, FundNotice[]>;
  noticesAt?: string;
  /** When each fund's announcements were last read; a fund that failed keeps its old time and goes first next run. */
  noticeReads?: Record<string, string>;
}

export const emptyStrategy = (): StrategyFile => ({ peers: {}, tracked: {}, notices: {} });

/** Exchange-traded ETFs (newer Shenzhen ones start with 158); LOFs (16xxxx, 50xxxx) can also be bought off-exchange at NAV. */
const ON_EXCHANGE = /^(?:15[89]|5[1-26-8]\d)/;

/** The scan runs on Sundays (Beijing time), and whenever the last one is missing or more than eight days old. */
export function scanDue(file: StrategyFile, now: Date): boolean {
  if (!file.checkedAt) return true;
  const age = now.getTime() - Date.parse(file.checkedAt);
  const sunday = new Date(`${dayKey(now)}T00:00:00Z`).getUTCDay() === 0;
  return age > 8 * 86_400_000 || (sunday && age > 20 * 3600_000);
}

/** Off-exchange index funds in the list whose name matches, in the wanted share classes ("" counts as A). */
export function candidatesFor(universe: UniverseFund[], pattern: RegExp, classes: Set<string>): UniverseFund[] {
  return universe.filter((f) => {
    if (!pattern.test(f.name) || /增强|指增|后端/.test(f.name) || ON_EXCHANGE.test(f.code)) return false;
    if (!/^(?:指数型|QDII)/.test(f.type) || /FOF/.test(f.type)) return false;
    const { cls, usd } = shareClass(f.name);
    return !usd && classes.has(cls || "A");
  });
}

const feeTotal = (fees: FundFees | undefined) => (fees?.management === undefined || fees.custody === undefined ? undefined : Math.round((fees.management + fees.custody) * 100) / 100);

/** Section 五 rule 4 for a candidate: management + custody within the cap for its kind. */
export function withinFeeRule(fees: FundFees | undefined, qdii: boolean): boolean {
  const total = feeTotal(fees);
  if (total === undefined) return false;
  const { domestic, domesticTolerance, qdii: qdiiCap } = INVEST_RULES.feeCap;
  return qdii ? total <= qdiiCap : total <= domestic + domesticTolerance;
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

export interface ScanDeps {
  universe: () => Promise<UniverseFund[]>;
  profile: (code: string) => Promise<ProfilePage>;
  feePage: (code: string) => Promise<FeePage>;
  trackingError: (code: string) => Promise<number | undefined>;
  concurrency?: number;
}

export interface ScanResult {
  file: Pick<StrategyFile, "checkedAt" | "peers" | "tracked" | "compared">;
  result: InvestSourceResult;
}

/**
 * The weekly comparison. Every off-exchange fund whose name suggests a tracked index is read once (基本概况:
 * 跟踪标的, fees, size, inception); those on the same index, in the A class (Y for pension shares), without
 * 增强 and within the fee rule get their purchase status read too. Share classes are added up for size.
 */
export async function scanPeers(funds: FundsFile, now: Date, deps: ScanDeps): Promise<ScanResult> {
  const started = Date.now();
  const limit = deps.concurrency ?? 6;
  const failed: string[] = [];
  const universe = await deps.universe();
  const byCode = new Map(universe.map((f) => [f.code, f]));
  const stems = new Map<string, UniverseFund[]>();
  for (const f of universe) {
    if (/后端/.test(f.name)) continue;
    const { stem } = shareClass(f.name);
    stems.set(stem, [...(stems.get(stem) ?? []), f]);
  }
  const siblingsOf = (code: string) => {
    const self = byCode.get(code);
    return self ? (stems.get(shareClass(self.name).stem) ?? []).filter((f) => f.code !== code) : [];
  };

  const targets = new Map<string, { pattern: RegExp; qdii: boolean; classes: Set<string> }>();
  const sameFund = new Map<string, UniverseFund>();
  for (const fund of FUNDS) {
    const data = funds.funds[fund.code];
    const index = INDICES.find((i) => i.id === fund.index);
    const tracked = data?.tracking?.index;
    const cls = shareClass(data?.name ?? fund.name).cls;
    if (tracked && index?.peers) {
      const target = targets.get(tracked) ?? { pattern: index.peers, qdii: index.market === "us", classes: new Set(["A"]) };
      if (cls === "Y") target.classes.add("Y");
      targets.set(tracked, target);
    } else if (!fund.etf && (data?.fees?.service ?? 0) > 0) {
      const a = siblingsOf(fund.code).find((f) => shareClass(f.name).cls === "A" && !shareClass(f.name).usd);
      if (a) sameFund.set(fund.code, a);
    }
  }

  const candidates = new Map<string, UniverseFund[]>();
  for (const [index, target] of targets) candidates.set(index, candidatesFor(universe, target.pattern, target.classes));
  const profiles = new Map<string, ProfilePage>();
  const readProfiles = (codes: string[]) =>
    mapLimit([...new Set(codes)].filter((c) => !profiles.has(c)), limit, async (code) => {
      try {
        profiles.set(code, await deps.profile(code));
      } catch (err) {
        failed.push(`${code}：${normalizeError(err).message}`);
      }
    });
  await readProfiles([...FUNDS.map((f) => f.code), ...[...candidates.values()].flat().map((f) => f.code), ...[...sameFund.values()].map((f) => f.code)]);

  const kept = new Map<string, { fund: UniverseFund; qdii: boolean }[]>();
  for (const [index, list] of candidates) {
    const qdii = targets.get(index)!.qdii;
    kept.set(
      index,
      list.flatMap((fund) => {
        const p = profiles.get(fund.code);
        if (!p?.index || collapse(p.index) !== collapse(index) || (p.fees?.service ?? 0) > 0 || !withinFeeRule(p.fees, qdii)) return [];
        return [{ fund, qdii }];
      }),
    );
  }
  for (const [code, a] of sameFund) {
    const p = profiles.get(a.code);
    const qdii = INDICES.find((i) => i.id === FUNDS.find((f) => f.code === code)?.index)?.market === "us";
    if (p?.fees && (p.fees.service ?? 0) === 0) kept.set(`same:${code}`, [{ fund: a, qdii }]);
  }

  // 基本概况 gives each share class's size; a fund's size is the sum over its classes.
  const { minSize } = INVEST_RULES.alternatives;
  const sized = [...[...kept.values()].flat().map(({ fund }) => fund.code), ...FUNDS.map((f) => f.code)];
  await readProfiles(sized.flatMap((code) => siblingsOf(code).map((f) => f.code)));
  const totalSize = (code: string) => {
    const own = profiles.get(code)?.size;
    return own === undefined ? undefined : own + siblingsOf(code).reduce((sum, f) => sum + (profiles.get(f.code)?.size ?? 0), 0);
  };

  const statusAt = new Date().toISOString();
  const peers: StrategyFile["peers"] = {};
  const toRead: PeerFund[] = [];
  for (const [index, list] of kept) {
    peers[index] = list.flatMap(({ fund, qdii }) => {
      const p = profiles.get(fund.code)!;
      const size = totalSize(fund.code);
      if (size !== undefined && size < minSize) return [];
      const peer: PeerFund = { code: fund.code, name: p.name ?? fund.name, cls: shareClass(fund.name).cls, qdii, fees: p.fees ?? {} };
      if (p.established) peer.established = p.established;
      if (size !== undefined) peer.size = size;
      if (p.sizeDate) peer.sizeDate = p.sizeDate;
      const stored = funds.funds[fund.code]?.status;
      if (stored) peer.status = stored;
      else toRead.push(peer);
      return [peer];
    });
  }
  await mapLimit([...new Set(toRead)], limit, async (peer) => {
    try {
      const page = await deps.feePage(peer.code);
      if (page.status) peer.status = { ...page.status, asOf: statusAt };
    } catch (err) {
      failed.push(`${peer.code}：${normalizeError(err).message}`);
    }
  });

  const tracked: StrategyFile["tracked"] = {};
  const indexFunds = FUNDS.filter((f) => funds.funds[f.code]?.tracking?.index);
  const errors = new Map<string, number | undefined>();
  await mapLimit(indexFunds, limit, async (fund) => {
    try {
      errors.set(fund.code, await deps.trackingError(fund.code));
    } catch (err) {
      failed.push(`${fund.code} 跟踪误差：${normalizeError(err).message}`);
    }
  });
  for (const fund of FUNDS) {
    const p = profiles.get(fund.code);
    const meta: TrackedMeta = {};
    const size = totalSize(fund.code);
    if (size !== undefined) meta.size = size;
    if (p?.sizeDate) meta.sizeDate = p.sizeDate;
    if (p?.established) meta.established = p.established;
    const te = errors.get(fund.code);
    if (te !== undefined) meta.trackingError = te;
    tracked[fund.code] = meta;
  }

  const compared = profiles.size;
  if (compared <= FUNDS.length) throw new Error(failed[0] ?? "没有读到同类基金");
  const result: InvestSourceResult = {
    id: "fund-peers",
    name: "同类基金比较（每周）",
    kind: "基金",
    ok: compared > FUNDS.length,
    count: Object.values(peers).reduce((n, list) => n + list.length, 0),
    ms: Date.now() - started,
  };
  if (failed.length) result.error = `${failed.length} 项没有读到：${failed.slice(0, 3).join("；")}${failed.length > 3 ? " 等" : ""}`;
  return { file: { checkedAt: now.toISOString(), peers, tracked, compared }, result };
}

export interface RefreshDeps {
  /** One attempt each; retries are paced here. */
  notices: (code: string) => Promise<FundNotice[]>;
  feePage: (code: string) => Promise<FeePage>;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/**
 * 天天基金's API and pages drop a few connections in some runs from GitHub's runners. Two at a time, three
 * attempts with jittered exponential backoff, a second pass for what failed, and a stop after a streak of
 * failed attempts so an outage does not hold up the update.
 */
const PACED = { concurrency: 2, attempts: 3, baseDelayMs: 1_000, breaker: 8, secondPassMs: 15_000, secondPassAttempts: 2 };

interface PacedRead<T> {
  values: Map<string, T>;
  /** Key → error message, in the order the keys first failed. */
  errors: Map<string, string>;
  ms: number;
}

async function readPaced<T>(keys: string[], read: (key: string) => Promise<T>, deps: Pick<RefreshDeps, "sleep" | "random">): Promise<PacedRead<T>> {
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
function pacedResult(id: string, name: string, total: number, read: PacedRead<unknown>): InvestSourceResult {
  const { errors } = read;
  const result: InvestSourceResult = { id, name, kind: "基金", ok: errors.size < total, count: total - errors.size, total, ms: read.ms };
  if (errors.size) {
    const listed = [...errors].slice(0, 3).map(([key, message]) => `${key}：${message}`);
    result.error = `${listed.join("；")}${errors.size > 3 ? ` 等 ${errors.size} 项` : ""}，下次运行优先重试`;
  }
  return result;
}

/** Oldest first: what earlier runs missed is read while the host is least busy. */
const oldestFirst = (keys: string[], readAt: (key: string) => string | undefined) => [...keys].sort((a, b) => (readAt(a) ?? "").localeCompare(readAt(b) ?? ""));

/** A fund whose announcements have not been read for this long is flagged: its stop signals could be missed. */
export const NOTICE_STALE_MS = 72 * 3_600_000;

/** In a file from before per-fund read times were kept, every fund counts as read when the last run read any. */
export function noticeReadTimes(file: Pick<StrategyFile, "noticeReads" | "noticesAt">): Record<string, string | undefined> {
  return Object.fromEntries(FUNDS.map((f) => [f.code, file.noticeReads ? file.noticeReads[f.code] : file.noticesAt]));
}

async function readNotices(file: StrategyFile, now: Date, deps: RefreshDeps): Promise<{ notices: StrategyFile["notices"]; reads: Record<string, string>; result: InvestSourceResult }> {
  const cutoff = now.getTime() - INVEST_RULES.stop.noticeDays * 86_400_000;
  const known = noticeReadTimes(file);
  const read = await readPaced(
    oldestFirst(
      FUNDS.map((f) => f.code),
      (code) => known[code],
    ),
    deps.notices,
    deps,
  );
  const notices = { ...file.notices };
  const reads: Record<string, string> = Object.fromEntries(Object.entries(known).filter((e): e is [string, string] => Boolean(e[1])));
  for (const [code, list] of read.values) {
    notices[code] = list.filter((n) => Date.parse(n.date) >= cutoff);
    reads[code] = now.toISOString();
  }
  return { notices, reads, result: pacedResult("fund-notices", "天天基金基金公告", FUNDS.length, read) };
}

/**
 * Every run: the tracked funds' material announcements, and the purchase status of overseas peers, whose
 * quotas change from week to week. Whatever fails keeps what the last run read.
 */
export async function refreshStrategy(file: StrategyFile, now: Date, deps: RefreshDeps): Promise<{ file: StrategyFile; results: InvestSourceResult[] }> {
  const read = await readNotices(file, now, deps);
  const next: StrategyFile = {
    ...file,
    notices: read.notices,
    noticeReads: read.reads,
    ...(read.result.ok ? { noticesAt: now.toISOString() } : {}),
    peers: Object.fromEntries(Object.entries(file.peers).map(([key, list]) => [key, list.map((p) => ({ ...p }))])),
  };

  const tracked = new Set(FUNDS.map((f) => f.code));
  const overseas = Object.values(next.peers)
    .flat()
    .filter((p) => p.qdii && !tracked.has(p.code));
  const results = [read.result];
  if (overseas.length) {
    const readAt = new Map<string, string>();
    for (const p of overseas) {
      const at = p.status?.asOf ?? "";
      if (!readAt.has(p.code) || at < readAt.get(p.code)!) readAt.set(p.code, at);
    }
    const codes = oldestFirst([...readAt.keys()], (code) => readAt.get(code));
    const statuses = await readPaced(codes, deps.feePage, deps);
    const at = new Date().toISOString();
    for (const p of overseas) {
      const status = statuses.values.get(p.code)?.status;
      if (status) p.status = { ...status, asOf: at };
    }
    results.push(pacedResult("peer-status", "同类 QDII 基金申购状态", codes.length, statuses));
  }
  return { file: next, results };
}

/** The weekly scan builds the peer lists afresh; a peer whose status it could not read keeps the last one. */
export function keepPeerStatus(peers: StrategyFile["peers"], previous: StrategyFile["peers"]): StrategyFile["peers"] {
  const known = new Map(
    Object.values(previous)
      .flat()
      .flatMap((p) => (p.status ? [[p.code, p.status] as const] : [])),
  );
  return Object.fromEntries(Object.entries(peers).map(([key, list]) => [key, list.map((p) => (p.status || !known.has(p.code) ? p : { ...p, status: known.get(p.code) }))]));
}

/** Tracked funds that are also someone's peer take the status read for them this run. */
export function syncTrackedStatus(file: StrategyFile, funds: FundsFile): StrategyFile {
  const peers = Object.fromEntries(
    Object.entries(file.peers).map(([key, list]) => [key, list.map((p) => (funds.funds[p.code]?.status ? { ...p, status: funds.funds[p.code].status } : p))]),
  );
  return { ...file, peers };
}
