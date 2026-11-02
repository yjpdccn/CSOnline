import { INDICES, INVEST_RULES, MACRO, type IndexId, type MacroId } from "@/config/invest";
import { translatedTitle } from "@/lib/pipeline/text";
import { dayKey } from "@/lib/time";
import { COMMENTARY, flashSignature } from "./flash";
import type { RankedCard } from "./news";
import type { Observation } from "./observations";
import type { MarketFile } from "./types";

/**
 * Major events between the weekly notes, for the top of the page and the push: big one-day moves,
 * valuation bands crossed, central bank rate decisions and widely covered policy news.
 */
export interface MarketEvent {
  id: string;
  kind: "move" | "valuation" | "rate" | "policy";
  /** When the event happened (the trading day's close for moves) or was first seen. */
  at: string;
  title: string;
  detail: string;
  url?: string;
}

export type ValuationBand = "low" | "mid" | "high";

/** data/invest/events.json */
export interface EventsFile {
  updatedAt: string;
  /** Last PE percentile band per index, with hysteresis. */
  bands: Partial<Record<IndexId, ValuationBand>>;
  events: MarketEvent[];
}

const RETENTION_DAYS = 7;

const MOVE_SERIES: { id: IndexId | MacroId; threshold: number }[] = [
  ...INDICES.filter((i) => i.market === "us" || i.market === "cn").filter((i) => !i.proxy).map((i) => ({ id: i.id, threshold: INVEST_RULES.events.indexMove })),
  { id: "xau", threshold: INVEST_RULES.events.goldMove },
  { id: "usdcnh", threshold: INVEST_RULES.events.fxMove },
];

const nameOf = (id: IndexId | MacroId) => INDICES.find((i) => i.id === id)?.name ?? MACRO.find((m) => m.id === id)?.name ?? id;
const shortDate = (day: string) => `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`;

function moves(market: MarketFile): MarketEvent[] {
  const out: MarketEvent[] = [];
  for (const { id, threshold } of MOVE_SERIES) {
    const closes = market.series[id]?.closes ?? [];
    const [prev, last] = [closes.at(-2), closes.at(-1)];
    if (!prev || !last) continue;
    const change = (last[1] / prev[1] - 1) * 100;
    if (Math.abs(change) < threshold) continue;
    const word = id === "usdcnh" ? (change > 0 ? "人民币走弱" : "人民币走强") : change > 0 ? "上涨" : "下跌";
    out.push({
      id: `move:${id}:${last[0]}`,
      kind: "move",
      at: new Date(`${last[0]}T23:59:00+08:00`).toISOString(),
      title: `${nameOf(id)} ${shortDate(last[0])}${word} ${Math.abs(change).toFixed(1)}%`,
      detail: `单日变动超过 ${threshold}%，收于 ${last[1].toLocaleString("en-US", { maximumFractionDigits: 4 })}。`,
    });
  }
  return out;
}

/** Enter the low band under 20%, leave it above 25%; enter the high band over 80%, leave it under 75%. */
export function nextBand(previous: ValuationBand | undefined, percentile: number): ValuationBand {
  const { low, high, margin } = INVEST_RULES.events.valuationBands;
  if (previous === "low" && percentile <= low + margin) return "low";
  if (previous === "high" && percentile >= high - margin) return "high";
  return percentile < low ? "low" : percentile > high ? "high" : "mid";
}

function valuations(market: MarketFile, bands: EventsFile["bands"]): { events: MarketEvent[]; bands: EventsFile["bands"] } {
  const events: MarketEvent[] = [];
  const next: EventsFile["bands"] = { ...bands };
  const { low, high } = INVEST_RULES.events.valuationBands;
  for (const index of INDICES) {
    const v = market.valuations[index.id];
    if (v?.pePercentile === undefined || v.pe === undefined) continue;
    const pct = v.pePercentile * 100;
    const band = nextBand(bands[index.id], pct);
    next[index.id] = band;
    const before = bands[index.id];
    if (!before || before === band) continue;
    const where = band === "low" ? `进入低估区（低于 ${low}%）` : band === "high" ? `进入高估区（高于 ${high}%）` : "回到中间区间";
    events.push({
      id: `valuation:${index.id}:${band}:${v.date}`,
      kind: "valuation",
      at: new Date(`${v.date}T23:59:00+08:00`).toISOString(),
      title: `${index.name}估值${where}`,
      detail: `市盈率 ${v.pe.toFixed(1)}，${v.since ? `${v.since.slice(0, 4)} 年以来` : "历史"}的分位 ${Math.round(pct)}%（${v.source}，${shortDate(v.date)}）。`,
    });
  }
  return { events, bands: next };
}

const PREVIEW = COMMENTARY;
const DECISION = /利率决议|利率决定|按兵不动|维持.{0,8}利率|宣布(?:加息|降息)|(?:上调|下调)(?:基准|政策)?利率|主要再融资利率|政策利率.{0,8}(?:维持|上调|下调)/;
const PBOC_MOVE = /降准|降息|(?:下调|上调).{0,12}(?:LPR|贷款市场报价利率|存款准备金率|政策利率|逆回购利率)/;
const MAJOR_BANKS = new Set(["cb:fed", "cb:ecb", "cb:boj", "cb:boe", "cb:pboc"]);
const POLICY_TOPICS = new Set(["policy-cn", "policy-us", "pboc", "fed", "cb"]);
const POLICY_ACTION = /宣布|出台|发布|实施|暂停|加征|关税|禁令|制裁|平准|入市|座谈会|一揽子|新政|紧急/;

/** Rate decisions and widely covered policy news from the last day or two of ranked news. */
function newsEvents(ranked: RankedCard[], now: Date): MarketEvent[] {
  const out: MarketEvent[] = [];
  const seenBanks = new Set<string>();
  const decisionsSince = now.getTime() - 36 * 3_600_000;
  const policySince = now.getTime() - 24 * 3_600_000;
  let policies = 0;
  for (const { item, topics } of ranked) {
    const published = Date.parse(item.publishedAt);
    const title = translatedTitle(item) ?? item.title;
    const sig = flashSignature(item.title);
    const banks = [...sig.entities].filter((e) => MAJOR_BANKS.has(e));
    const sources = new Set([item.sourceId, ...(item.related ?? []).map((r) => r.sourceId)]).size;
    if (published >= decisionsSince && banks.length === 1 && !PREVIEW.test(item.title)) {
      const bank = banks[0];
      const decided = bank === "cb:pboc" ? PBOC_MOVE.test(item.title) : DECISION.test(item.title);
      const key = `${bank}:${dayKey(item.publishedAt)}`;
      if (decided && !seenBanks.has(key)) {
        seenBanks.add(key);
        out.push({ id: `rate:${key}`, kind: "rate", at: item.publishedAt, title, detail: `${item.sourceName}${sources > 1 ? ` 等 ${sources} 家来源` : ""}`, url: item.url });
        continue;
      }
    }
    if (policies < 2 && published >= policySince && topics.some((t) => POLICY_TOPICS.has(t)) && !PREVIEW.test(item.title)) {
      const wide = sources >= INVEST_RULES.events.policySources;
      if (wide && POLICY_ACTION.test(item.title)) {
        policies++;
        out.push({ id: `policy:${item.id}`, kind: "policy", at: item.publishedAt, title, detail: `${item.sourceName} 等 ${sources} 家来源报道`, url: item.url });
      }
    }
  }
  return out;
}

export function detectEvents(input: { market: MarketFile; ranked: RankedCard[]; previous: EventsFile | null; now: Date }): EventsFile {
  const { market, ranked, previous, now } = input;
  const cutoff = now.getTime() - RETENTION_DAYS * 86_400_000;
  const kept = (previous?.events ?? []).filter((e) => Date.parse(e.at) >= cutoff);
  const known = new Set(kept.map((e) => e.id));
  const valuation = valuations(market, previous?.bands ?? {});
  // The first run only records the bands: a crossing needs a band to cross from.
  const fresh = [...moves(market), ...(previous ? valuation.events : []), ...newsEvents(ranked, now)].filter((e) => Date.parse(e.at) >= cutoff && !known.has(e.id));
  return { updatedAt: now.toISOString(), bands: valuation.bands, events: [...fresh, ...kept].sort((a, b) => b.at.localeCompare(a.at)) };
}

/** Events as observations: shown at the top for a few days and pushed once. */
export function eventObservations(file: EventsFile | null, now: Date): Observation[] {
  const since = now.getTime() - INVEST_RULES.events.showDays * 86_400_000;
  return (file?.events ?? [])
    .filter((e) => Date.parse(e.at) >= since)
    .map((e) => {
      const item: Observation = { key: e.id, kind: "event", severity: e.kind === "move" || e.kind === "valuation" ? "warn" : "info", title: e.title, detail: e.detail, at: e.at };
      if (e.url) item.url = e.url;
      return item;
    });
}
