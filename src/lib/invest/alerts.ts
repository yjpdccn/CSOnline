import { FUNDS, INDICES } from "@/config/invest";
import { usHolidayOrder } from "./sessions";
import type { AlertEvent, AlertsFile, FundFees, FundStatus, FundView, LastSeen, PremiumBand } from "./types";

/** Change events are kept this long in data/invest/alerts.json; the page shows the recent ones. */
const EVENT_RETENTION_DAYS = 30;

const US_FUNDS = new Set(FUNDS.filter((f) => INDICES.find((i) => i.id === f.index)?.market === "us").map((f) => f.code));

/**
 * The US market holiday a fund on US markets is paused for, when it was open before: each such QDII pauses
 * purchases and 定投 on overseas market holidays under its annual 境外主要市场节假日 notice, then reopens as before.
 */
export function holidayPause(code: string, status: Pick<FundStatus, "purchase"> & { asOf: string }, seen: LastSeen | undefined): string | undefined {
  if (!US_FUNDS.has(code) || statusRank(status.purchase) !== 0 || !seen || statusRank(seen.purchase) <= 0) return undefined;
  return usHolidayOrder(status.asOf);
}

/** A holiday pause recorded as a quota cut and then a reopening to the same status becomes one holiday pause. */
function mergeHolidayPairs(events: AlertEvent[]): AlertEvent[] {
  const merged = new Set<string>();
  const pauses: AlertEvent[] = [];
  for (const down of events) {
    if (down.kind !== "limit-down" || !US_FUNDS.has(down.code) || statusRank(down.to) !== 0) continue;
    const holiday = usHolidayOrder(down.at);
    const up = holiday && events.find((e) => e.kind === "limit-up" && e.code === down.code && e.from === down.to && e.to === down.from && e.at > down.at && Date.parse(e.at) - Date.parse(down.at) < 3 * 86_400_000);
    if (!up) continue;
    merged.add(down.id).add(up.id);
    pauses.push({ id: `holiday-pause:${down.code}:${down.at}`, kind: "holiday-pause", code: down.code, at: down.at, from: down.from, holiday, severity: "info" });
  }
  return [...events.filter((e) => !merged.has(e.id)), ...pauses];
}

/** 暂停申购 < 限大额 < 开放申购; -1 for states that say nothing about capacity (认购期, 封闭期…). */
export function statusRank(purchase: string | undefined): number {
  if (!purchase) return -1;
  if (/暂停|停止|关闭/.test(purchase)) return 0;
  if (/限/.test(purchase)) return 1;
  if (/开放/.test(purchase)) return 2;
  return -1;
}

export function formatLimit(limit: number | null | undefined): string | undefined {
  if (limit === undefined) return undefined;
  if (limit === null) return "不限额";
  if (limit >= 1e8) return `${+(limit / 1e8).toFixed(2)} 亿元/日`;
  if (limit >= 1e4) return `${+(limit / 1e4).toFixed(2)} 万元/日`;
  return `${+limit.toFixed(2)} 元/日`;
}

export function describeStatus(s: Pick<FundStatus, "purchase" | "limit" | "dca"> | LastSeen): string {
  const parts = [s.purchase ?? "未知"];
  if (statusRank(s.purchase) === 1 && s.limit !== undefined && s.limit !== null) parts.push(formatLimit(s.limit)!);
  if (s.dca && s.dca !== "支持") parts.push(`定投${s.dca}`);
  return parts.join(" · ");
}

/** "down" when buying got harder (paused, lower limit, 定投 off), "up" when it got easier. */
export function compareStatus(prev: LastSeen, cur: Pick<FundStatus, "purchase" | "limit" | "dca">): "down" | "up" | null {
  const r0 = statusRank(prev.purchase);
  const r1 = statusRank(cur.purchase);
  if (r0 < 0 || r1 < 0) return null;
  if (r1 !== r0) return r1 < r0 ? "down" : "up";
  if (r1 === 1 && typeof prev.limit === "number" && typeof cur.limit === "number" && prev.limit !== cur.limit) {
    return cur.limit < prev.limit ? "down" : "up";
  }
  if (prev.dca && cur.dca && prev.dca !== cur.dca) return cur.dca === "支持" ? "up" : "down";
  return null;
}

const FEE_LABELS: [keyof FundFees, string][] = [
  ["management", "管理费"],
  ["custody", "托管费"],
  ["service", "销售服务费"],
];

const BAND_LABEL: Record<PremiumBand, string> = { low: "2% 以内", mid: "2%–3%", high: "3% 以上", normal: "正常范围", unusual: "偏离较大" };
const QDII_BANDS = new Set<PremiumBand>(["low", "mid", "high"]);

/**
 * Compares this run's fund data with what the last run saw and records the changes. Values a run could
 * not fetch keep their last-seen state, so a failed request never looks like a change.
 */
export function diffAlerts(prev: AlertsFile | null, views: FundView[], now: Date): AlertsFile {
  const at = now.toISOString();
  const cutoff = now.getTime() - EVENT_RETENTION_DAYS * 86_400_000;
  const events = mergeHolidayPairs((prev?.events ?? []).filter((e) => Date.parse(e.at) >= cutoff));
  // Only funds still on the page: one taken off leaves nothing behind.
  const lastSeen: Record<string, LastSeen> = {};
  const push = (event: Omit<AlertEvent, "id" | "at">) => events.push({ ...event, id: `${event.kind}:${event.code}:${at}`, at });

  for (const view of views) {
    const seen = prev?.lastSeen[view.code];
    const next: LastSeen = { ...seen, at };

    const holiday = view.watchLimit && view.status ? holidayPause(view.code, view.status, seen) : undefined;
    if (holiday) {
      // The last status stays, so reopening as before is no change and reopening differently is one.
      if (!events.some((e) => e.kind === "holiday-pause" && e.code === view.code && e.holiday === holiday)) {
        push({ kind: "holiday-pause", code: view.code, from: describeStatus(seen!), holiday, severity: "info" });
      }
    } else if (view.watchLimit && view.status) {
      const cur = { purchase: view.status.purchase, limit: view.status.limit, dca: view.status.dca };
      const change = seen?.purchase ? compareStatus(seen, cur) : null;
      if (change && seen) {
        push({
          kind: change === "down" ? "limit-down" : "limit-up",
          code: view.code,
          from: describeStatus(seen),
          to: describeStatus(cur),
          severity: change === "down" ? "bad" : "good",
        });
      }
      next.purchase = cur.purchase;
      if (cur.limit !== undefined) next.limit = cur.limit;
      else delete next.limit;
      if (cur.dca) next.dca = cur.dca;
    }

    if (view.fees) {
      const fees: FundFees = {};
      for (const [key, label] of FEE_LABELS) {
        const value = view.fees[key];
        if (value === undefined) continue;
        fees[key] = value;
        const old = seen?.fees?.[key];
        if (old !== undefined && old !== value) {
          push({ kind: "fee-change", code: view.code, from: `${label} ${old}%`, to: `${label} ${value}%`, severity: value > old ? "warn" : "good" });
        }
      }
      if (Object.keys(fees).length) next.fees = { ...seen?.fees, ...fees };
    }

    if (view.watchPremium && view.premium) {
      const band = view.premium.band;
      const old = seen?.premiumBand;
      const comparable = old !== undefined && QDII_BANDS.has(old) === QDII_BANDS.has(band);
      if (comparable && old !== band) {
        if (view.premium.kind === "qdii" && (band === "low" || old === "low")) {
          push({
            kind: band === "low" ? "premium-low" : "premium-high",
            code: view.code,
            from: BAND_LABEL[old],
            to: `${view.premium.value}%`,
            severity: band === "low" ? "good" : "warn",
          });
        } else if (view.premium.kind === "domestic" && band === "unusual") {
          push({ kind: "premium-unusual", code: view.code, from: BAND_LABEL[old], to: `${view.premium.value}%`, severity: "warn" });
        }
      }
      next.premiumBand = band;
    }

    lastSeen[view.code] = next;
  }
  return { updatedAt: at, lastSeen, events: events.sort((a, b) => b.at.localeCompare(a.at)) };
}
