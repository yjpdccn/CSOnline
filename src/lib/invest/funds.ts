import { FUNDS, INDICES, INVEST_RULES, type FundConfig } from "@/config/invest";
import { shiftDay } from "@/lib/time";
import type { Close, FeeRuleCheck, FundData, FundFees, FundView, MarketFile, NavPoint, Premium, PremiumBand } from "./types";

export function premiumBand(value: number): PremiumBand {
  const { low, high } = INVEST_RULES.premium;
  return value < low ? "low" : value < high ? "mid" : "high";
}

/** Last close on or before `date`. */
export function closeOnOrBefore(closes: Close[], date: string): Close | undefined {
  for (let i = closes.length - 1; i >= 0; i--) if (closes[i][0] <= date) return closes[i];
  return undefined;
}

/**
 * Premium of an on-exchange QDII ETF over its NAV. The price is the A-share close; the fair comparison is
 * the NAV at the last US close before it. When the published NAV is older, it is moved forward by the
 * index and USD/CNH change since its date (the way 集思录 estimates it).
 */
export function computePremium(prices: Close[], navs: NavPoint[], index?: Close[], fx?: Close[]): Premium | undefined {
  const last = prices.at(-1);
  const nav = navs.find((n) => last && n.date <= last[0]);
  if (!last || !nav) return undefined;
  const [priceDate, price] = last;
  let fair = nav.nav;
  let estimated = false;
  if (index?.length) {
    const base = closeOnOrBefore(index, nav.date);
    const target = closeOnOrBefore(index, shiftDay(priceDate, -1));
    if (base && target && target[0] > nav.date) {
      fair *= target[1] / base[1];
      const fxBase = fx && closeOnOrBefore(fx, nav.date);
      const fxTarget = fx && closeOnOrBefore(fx, target[0]);
      if (fxBase && fxTarget) fair *= fxTarget[1] / fxBase[1];
      estimated = true;
    }
  }
  const value = Math.round((price / fair - 1) * 10_000) / 100;
  return { value, band: premiumBand(value), price, priceDate, nav: nav.nav, navDate: nav.date, estimated };
}

/** Section 五, rule 4: index funds keep management + custody near 0.2% a year (A shares, gold) or within 1% (QDII). */
export function checkFeeRule(fund: FundConfig, data: FundData | undefined, fees: FundFees | undefined): FeeRuleCheck | undefined {
  if (fees?.management === undefined || fees.custody === undefined) return undefined;
  const type = data?.type ?? "";
  const name = data?.name ?? fund.name;
  const indexFund = fund.etf || type.startsWith("指数型") || /指数|ETF/.test(name);
  if (!indexFund) return undefined;
  const qdii = /QDII|海外/.test(`${type} ${name}`) || INDICES.find((i) => i.id === fund.index)?.market === "us";
  const total = Math.round((fees.management + fees.custody) * 100) / 100;
  const { domestic, domesticTolerance, qdii: qdiiCap } = INVEST_RULES.feeCap;
  return qdii
    ? { kind: "qdii", cap: qdiiCap, total, ok: total <= qdiiCap }
    : { kind: "domestic", cap: domestic, total, ok: total <= domestic + domesticTolerance };
}

/** Change over about a week: latest value against the last one at least seven days earlier. */
export function weekChange(points: { date: string; value: number }[]): number | undefined {
  const latest = points.at(-1);
  if (!latest) return undefined;
  const target = shiftDay(latest.date, -7);
  const base = [...points].reverse().find((p) => p.date <= target);
  return base ? Math.round((latest.value / base.value - 1) * 10_000) / 100 : undefined;
}

export function buildFundViews(funds: Record<string, FundData>, market: MarketFile): FundView[] {
  return FUNDS.map((fund) => {
    const data = funds[fund.code];
    const index = INDICES.find((i) => i.id === fund.index)!;
    const view: FundView = {
      code: fund.code,
      name: data?.name ?? fund.name,
      group: fund.group,
      etf: Boolean(fund.etf),
      index: fund.index,
      indexName: index.name,
      watchLimit: Boolean(fund.watchLimit),
      watchPremium: Boolean(fund.watchPremium),
    };
    if (fund.tag) view.tag = fund.tag;
    if (data?.type) view.type = data.type;
    const navs = data?.navs ?? [];
    if (navs[0]) view.nav = navs[0];
    if (data?.prices?.length) {
      const [date, close] = data.prices.at(-1)!;
      const prev = data.prices.at(-2);
      view.price = { close, date, changePct: prev ? Math.round((close / prev[1] - 1) * 10_000) / 100 : undefined };
      view.weekPct = weekChange(data.prices.map(([d, v]) => ({ date: d, value: v })));
      if (fund.watchPremium && navs.length) {
        const fx = market.series.usdcnh?.closes;
        const premium = computePremium(data.prices, navs, market.series[fund.index]?.closes, index.market === "us" ? fx : undefined);
        if (premium) view.premium = premium;
      }
    } else if (navs.length) {
      view.weekPct = weekChange([...navs].reverse().map((n) => ({ date: n.date, value: n.nav })));
    }
    if (data?.status) view.status = data.status;
    if (data?.fees) {
      const total = data.fees.management !== undefined && data.fees.custody !== undefined ? Math.round((data.fees.management + data.fees.custody) * 100) / 100 : undefined;
      view.fees = { ...data.fees, total };
      const rule = checkFeeRule(fund, data, data.fees);
      if (rule) view.feeRule = rule;
    }
    if (data?.tracking?.index) view.tracking = data.tracking.index;
    if (data?.tracking?.benchmark) view.benchmark = data.tracking.benchmark;
    return view;
  });
}
