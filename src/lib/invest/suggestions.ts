import { FUND_GROUPS, FUNDS, GROUP_ROLE, INDICES, INVEST_RULES, INVEST_SITE, type FundRole, type IndexId } from "@/config/invest";
import { formatLimit, statusRank } from "./alerts";
import { premiumBasis, type Observation, type SuggestionAction } from "./observations";
import { shareClass } from "./sources/funds";
import type { PeerFund, StrategyFile } from "./strategy";
import type { AlertEvent, FundFees, FundStatus, FundView } from "./types";

export const NOTE = "仅供参考，不构成投资建议。";
const ALT = INVEST_RULES.alternatives;
const STOP = INVEST_RULES.stop;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Yearly cost of holding: management + custody + sales service fee, percent. */
export function allIn(fees: FundFees | undefined): number | undefined {
  if (fees?.management === undefined || fees.custody === undefined) return undefined;
  return round2(fees.management + fees.custody + (fees.service ?? 0));
}

/** What one person can buy a day: 0 when paused, Infinity when open or out of reach, NaN when unknown. */
export function capacity(status: Pick<FundStatus, "purchase" | "limit"> | undefined): number {
  const rank = statusRank(status?.purchase);
  if (rank === 0) return 0;
  if (rank === 2 || (rank === 1 && status?.limit === null)) return Infinity;
  if (rank === 1 && typeof status?.limit === "number") return status.limit >= ALT.noLimit ? Infinity : status.limit;
  return NaN;
}

function quota(status: FundStatus | undefined): string {
  const rank = statusRank(status?.purchase);
  if (rank === 0) return "暂停申购";
  if (rank === 2 || status?.limit === null) return "开放申购";
  if (typeof status?.limit === "number") return `日限额 ${formatLimit(status.limit)!.replace("/日", "")}`;
  return status?.purchase ?? "申购状态未知";
}

const sizeText = (size: number | undefined) => (size === undefined ? "" : size >= 1e8 ? `规模 ${(size / 1e8).toFixed(1)} 亿元` : `规模 ${Math.round(size / 1e4)} 万元`);

function ageText(established: string | undefined, now: Date): string {
  if (!established) return "";
  const days = (now.getTime() - Date.parse(`${established}T00:00:00+08:00`)) / 86_400_000;
  return days < ALT.minHistoryDays ? `成立不满一年（${established} 成立），历史较短` : `成立 ${Math.floor(days / 365)} 年`;
}

const facts = (p: PeerFund, now: Date) => [`每年费用 ${allIn(p.fees)?.toFixed(2)}%`, quota(p.status), sizeText(p.size), ageText(p.established, now)].filter(Boolean).join("，");

const roleOf = (code: string): FundRole => {
  const fund = FUNDS.find((f) => f.code === code)!;
  return fund.role ?? GROUP_ROLE[fund.group];
};

/** A组 and B组 are named by their label only. */
const label = (v: FundView) => {
  const group = v.group === "groupA" || v.group === "groupB" ? `${FUND_GROUPS.find((g) => g.id === v.group)!.label} · ` : "";
  return `${group}${v.name}（${v.code}）`;
};

const indexName = (id: IndexId) => INDICES.find((i) => i.id === id)!.name;

function sameAs(v: FundView, p: PeerFund): string {
  if (shareClass(v.name).stem === shareClass(p.name).stem) return `是同一只基金的 ${p.cls || "A"} 类份额`;
  return v.index === "gold" ? "同样投资黄金（跟踪上金所 Au99.99）" : `同样跟踪${indexName(v.index)}`;
}

/** "华夏黄金ETF联接A（008701），同样投资黄金…，每年费用 0.20%，…" */
const described = (v: FundView, p: PeerFund, now: Date) => `${p.name}（${p.code}），${sameAs(v, p)}，${facts(p, now)}`;

function peersOf(v: FundView, strategy: StrategyFile): PeerFund[] {
  return (v.tracking ? strategy.peers[v.tracking] : strategy.peers[`same:${v.code}`]) ?? [];
}

/** QDII funds already bought by 定投 have no daily quota to spare. */
const DCA_CODES = new Set(FUNDS.filter((f) => (f.role ?? GROUP_ROLE[f.group]) === "dca").map((f) => f.code));

/** A candidate that fits the rules: same share class family (Y for pension shares), open, big enough. */
function usable(v: FundView, p: PeerFund): boolean {
  if (p.code === v.code || (p.qdii && DCA_CODES.has(p.code))) return false;
  return (p.cls === "Y") === (shareClass(v.name).cls === "Y") && capacity(p.status) > 0 && (p.size ?? 0) >= ALT.minSize;
}

/** Cheapest by at least the minimum saving, open with a daily limit no lower than the fund's own. */
function cheaper(v: FundView, peers: PeerFund[]): { peer: PeerFund; saving: number } | undefined {
  const own = allIn(v.fees);
  if (own === undefined) return undefined;
  const current = capacity(v.status);
  const options = peers.flatMap((p) => {
    const cost = allIn(p.fees);
    if (!usable(v, p) || cost === undefined || (!Number.isNaN(current) && capacity(p.status) < current)) return [];
    const saving = round2(own - cost);
    return saving >= ALT.minSaving - 1e-9 ? [{ peer: p, saving }] : [];
  });
  options.sort((a, b) => b.saving - a.saving || capacity(b.peer.status) - capacity(a.peer.status) || (b.peer.size ?? 0) - (a.peer.size ?? 0));
  return options[0];
}

/** Any open alternative, cheapest first, for a fund that should not be bought now. */
function openAlternative(v: FundView, peers: PeerFund[]): PeerFund | undefined {
  return peers
    .filter((p) => usable(v, p))
    .sort((a, b) => (allIn(a.fees) ?? 9) - (allIn(b.fees) ?? 9) || capacity(b.status) - capacity(a.status) || (b.size ?? 0) - (a.size ?? 0))[0];
}

/** The open alternative with the most daily quota, at least `threshold`. */
function moreQuota(v: FundView, peers: PeerFund[], exclude: Set<string>, threshold: number): PeerFund | undefined {
  return peers
    .filter((p) => !exclude.has(p.code) && usable(v, p) && capacity(p.status) >= threshold)
    .sort((a, b) => capacity(b.status) - capacity(a.status) || (allIn(a.fees) ?? 9) - (allIn(b.fees) ?? 9) || (b.size ?? 0) - (a.size ?? 0))[0];
}

function trackingErrorCap(v: FundView): number {
  if (v.etf) return STOP.trackingError.etf;
  return INDICES.find((i) => i.id === v.index)?.market === "us" ? STOP.trackingError.qdii : STOP.trackingError.domestic;
}

/** What to do instead, in the wording of how the fund is used. */
function insteadOf(role: FundRole, v: FundView, alt: PeerFund | undefined, now: Date, fallback: string): string {
  if (!alt) return fallback;
  const lead = role === "dca" ? "可以考虑暂停定投，改投" : role === "planned" ? "可以考虑改选" : "可以考虑换成";
  return `${lead}${described(v, alt, now)}`;
}

const SEVERITY = { stop: "bad", replace: "warn", increase: "good" } as const;

function suggestion(action: SuggestionAction, key: string, code: string | undefined, title: string, detail: string, target?: PeerFund): Observation {
  const item: Observation = { key, kind: "suggestion", action, severity: SEVERITY[action], title, detail: `${detail}${NOTE}` };
  if (code) item.code = code;
  if (target) item.target = { code: target.code, name: target.name };
  return item;
}

/**
 * Strategy suggestions from the rules: stop signals (every run), cheaper funds on the same index or metal
 * (from the weekly comparison) and cues to add to the overseas part (quota reopening, on-exchange premium
 * back under 2%). A fund with a stop signal gets its alternative there rather than a second item.
 */
export function buildSuggestions(views: FundView[], strategy: StrategyFile, events: AlertEvent[], now: Date): Observation[] {
  const out: Observation[] = [];
  const recent = events.filter((e) => now.getTime() - Date.parse(e.at) <= INVEST_SITE.alertDays * 86_400_000);
  const noticeCutoff = now.getTime() - STOP.noticeDays * 86_400_000;

  for (const v of views) {
    const fund = FUNDS.find((f) => f.code === v.code)!;
    const role = roleOf(v.code);
    const peers = peersOf(v, strategy);
    const meta = strategy.tracked[v.code];
    const name = label(v);
    const stopped: Observation[] = [];

    if (v.etf && v.premium?.kind === "qdii") {
      const p = v.premium;
      const shown = `${p.value < 0 ? "折价" : "溢价"} ${Math.abs(p.value).toFixed(2)}%`;
      if (p.band === "low") {
        out.push(suggestion("increase", `increase:premium:${v.code}`, v.code, `场内 ${name} ${shown}`, `在规则三的 ${INVEST_RULES.premium.low}% 以内（${premiumBasis(p)}）。可以考虑在场内买入。`));
      } else {
        const alt = openAlternative(v, peers);
        const where = p.band === "mid" ? "在规则三的 2%–3% 之间" : "高于规则三的 2%–3%";
        stopped.push(
          suggestion("stop", `stop:premium:${v.code}`, v.code, `场内 ${name} ${shown}`, `${where}（${premiumBasis(p)}）。可以考虑暂缓场内买入${alt ? `，改用场外的${described(v, alt, now)}` : "，等溢价回落"}。`, alt),
        );
      }
    } else if (v.etf && v.premium?.band === "unusual" && v.premium.value > 0) {
      const p = v.premium;
      stopped.push(
        suggestion("stop", `stop:premium:${v.code}`, v.code, `场内 ${name} 溢价 ${p.value.toFixed(2)}%`, `高于净值超过 ${INVEST_RULES.domesticPremium.unusual}%（${premiumBasis(p)}），境内 ETF 通常只在净值上下零点几个百分点。可以考虑暂缓场内买入，等溢价回落。`),
      );
    }

    // On-exchange ETFs trade whatever their creation status; a QDII fund waiting for quota is expected to be paused.
    if (!v.etf && v.status && !(role === "planned" && fund.addOnReopen)) {
      const paused = statusRank(v.status.purchase) === 0;
      const noDca = role === "dca" && v.status.dca !== undefined && v.status.dca !== "支持";
      if (paused || noDca) {
        const alt = openAlternative(v, peers);
        const what = paused ? "暂停申购" : "暂停定投";
        const fallback = role === "held" ? "已持有的份额不受影响，暂时不能再买入。" : "可以考虑暂缓，等恢复申购。";
        stopped.push(suggestion("stop", `stop:paused:${v.code}`, v.code, `${name}${what}`, `${insteadOf(role, v, alt, now, fallback)}${alt ? "。" : ""}`, alt));
      }
    }

    for (const e of recent) {
      if (e.code !== v.code) continue;
      if (e.kind === "fee-change" && e.severity === "warn" && v.feeRule && !v.feeRule.ok) {
        const alt = openAlternative(v, peers);
        const rule = v.feeRule.kind === "qdii" ? `QDII ${v.feeRule.cap}% 以内` : `约 ${v.feeRule.cap}%`;
        stopped.push(
          suggestion("stop", `stop:fee:${e.id}`, v.code, `${name}费率上调`, `${e.from} → ${e.to}，管理费加托管费 ${v.feeRule.total.toFixed(2)}%/年，超过规则四的${rule}。${insteadOf(role, v, alt, now, "可以考虑停止买入")}。`, alt),
        );
      }
      if (e.kind === "limit-down" && role === "dca" && statusRank(v.status?.purchase) !== 0) {
        const alt = moreQuota(v, peers, new Set([v.code]), Math.max(capacity(v.status) * ALT.quotaFactor, ALT.minQuota));
        stopped.push(
          suggestion("stop", `stop:limit:${e.id}`, v.code, `${name}日限额下调`, `${e.from} → ${e.to}。可以考虑按新额度调整定投金额${alt ? `，或改投${described(v, alt, now)}` : ""}。`, alt),
        );
      }
      if (e.kind === "limit-up" && fund.addOnReopen) {
        out.push(suggestion("increase", `increase:reopen:${e.id}`, v.code, `${name}${/暂停/.test(e.from ?? "") ? "恢复申购" : "申购额度放开"}`, `${e.from} → ${e.to}。海外部分可以考虑加大投入。`));
      }
    }

    if (meta?.size !== undefined && meta.size < STOP.minSize) {
      const alt = openAlternative(v, peers);
      stopped.push(
        suggestion(
          "stop",
          `stop:size:${v.code}`,
          v.code,
          `${name}规模过小`,
          `${sizeText(meta.size)}${meta.sizeDate ? `（截至 ${meta.sizeDate}）` : ""}，低于 ${STOP.minSize / 1e4} 万元，有清盘的可能。${insteadOf(role, v, alt, now, "可以考虑停止买入")}。`,
          alt,
        ),
      );
    }
    for (const n of strategy.notices[v.code] ?? []) {
      if (Date.parse(n.date) < noticeCutoff) continue;
      const alt = openAlternative(v, peers);
      stopped.push(
        suggestion("stop", `stop:notice:${v.code}:${n.id}`, v.code, `${name}发布重要公告`, `${n.date}「${n.title}」。可以考虑先暂停买入，看清公告内容${alt ? `；同类可选${described(v, alt, now)}` : ""}。`, alt),
      );
    }
    if (meta?.trackingError !== undefined && meta.trackingError > trackingErrorCap(v)) {
      const alt = openAlternative(v, peers);
      stopped.push(
        suggestion(
          "stop",
          `stop:te:${v.code}`,
          v.code,
          `${name}跟踪误差偏大`,
          `近一年年化跟踪误差 ${meta.trackingError.toFixed(2)}%，这类基金通常在 ${trackingErrorCap(v)}% 以内。${insteadOf(role, v, alt, now, "可以考虑停止买入")}。`,
          alt,
        ),
      );
    }
    out.push(...stopped);

    if (!v.etf && !stopped.some((s) => s.target)) {
      const best = cheaper(v, peers);
      if (best) {
        const own = allIn(v.fees)!;
        const service = v.fees?.service ? `（含销售服务费 ${v.fees.service.toFixed(2)}%）` : "";
        const lead = role === "dca" ? "可以考虑把定投改到" : role === "planned" ? "可以考虑改选" : "可以考虑换成";
        const p = best.peer;
        const paused = capacity(v.status) === 0 ? `${quota(p.status)}（现在这只暂停申购）` : quota(p.status);
        const detail = `${lead}${p.name}（${p.code}），${sameAs(v, p)}，每年费用 ${allIn(p.fees)!.toFixed(2)}%，比现在的 ${own.toFixed(2)}%${service || " "}低 ${best.saving.toFixed(2)}%；${[paused, sizeText(p.size), ageText(p.established, now)].filter(Boolean).join("，")}。${role === "held" ? "已持有的份额卖出前留意赎回费。" : ""}`;
        out.push(suggestion("replace", `replace:${v.code}:${p.code}`, v.code, name, detail, p));
      }
    }
  }

  // Overseas quota: the funds bought or planned for the overseas part are paused or capped low, a peer is not.
  const overseas = new Map<IndexId, FundView[]>();
  for (const v of views) if (!v.etf && FUNDS.find((f) => f.code === v.code)?.addOnReopen) overseas.set(v.index, [...(overseas.get(v.index) ?? []), v]);
  for (const [index, list] of overseas) {
    const caps = list.map((v) => capacity(v.status)).filter((c) => !Number.isNaN(c));
    const current = Math.max(0, ...caps);
    if (current === Infinity) continue;
    const best = moreQuota(list[0], peersOf(list[0], strategy), new Set(list.map((v) => v.code)), Math.max(current * ALT.quotaFactor, ALT.minQuota));
    if (!best) continue;
    const cap = capacity(best.status);
    const tier = cap === Infinity ? "open" : String(10 ** Math.floor(Math.log10(cap)));
    const codes = list.map((v) => v.code).join("、");
    const state = current === 0 ? `${codes} 暂停申购` : `${codes} 日限额 ${formatLimit(current)!.replace("/日", "")}`;
    out.push(
      suggestion(
        "increase",
        `increase:quota:${index}:${best.code}:${tier}`,
        undefined,
        `${indexName(index)}：${best.name}（${best.code}）${quota(best.status)}`,
        `${state}；${best.name}${sameAs(list[0], best)}，${[`每年费用 ${allIn(best.fees)!.toFixed(2)}%`, sizeText(best.size), ageText(best.established, now)].filter(Boolean).join("，")}。海外部分可以考虑通过它加大投入。`,
        best,
      ),
    );
  }
  return out;
}
