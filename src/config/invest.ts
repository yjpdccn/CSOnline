/**
 * 投资日报的配置：关注的基金、它们跟踪的指数、宏观指标和提醒规则。
 *
 * 仓库和网页都是公开的：这里只放基金名称、代码、公开行情的代码和规则阈值，
 * 不放任何金额、配置比例或个人日期。
 *
 * - 换基金：增删 FUNDS 里的一行。`index` 指向 INDICES 里的一项，决定显示哪条指数行情、估值和相关新闻。
 * - 新指数：在 INDICES 加一行（东方财富 secid 可在 quote.eastmoney.com 的网址里找到）。
 */

export type FundGroup = "dca" | "pension" | "later";

export const FUND_GROUPS: { id: FundGroup; label: string; hint: string }[] = [
  { id: "dca", label: "正在定投", hint: "净值、跟踪指数、申购状态与费率" },
  { id: "pension", label: "个人养老金", hint: "中证A500 / 沪深300 的 Y 份额候选" },
  { id: "later", label: "以后再买", hint: "场外基金与场内 ETF" },
];

export type IndexId = "ndx" | "spx" | "spxew" | "a500" | "csi300" | "divlowvol" | "gold" | "cnbond";

export interface FundConfig {
  code: string;
  /** Fallback name; the name 天天基金 returns is shown when available. */
  name: string;
  group: FundGroup;
  index: IndexId;
  /** On-exchange ETF: shows the traded price and, for QDII, the premium. */
  etf?: boolean;
  /** Short label next to the name. */
  tag?: string;
  /** Alert when the purchase status or the daily purchase limit changes. */
  watchLimit?: boolean;
  /**
   * Show the premium over NAV in the alert panel. QDII ETFs get the 2% / 2–3% rule; domestic ETFs are
   * flagged only when the premium or discount is unusual.
   */
  watchPremium?: boolean;
}

export const FUNDS: FundConfig[] = [
  // 正在定投
  { code: "019172", name: "摩根纳斯达克100指数(QDII)人民币A", group: "dca", index: "ndx", watchLimit: true },
  { code: "016452", name: "南方纳斯达克100指数发起(QDII)A", group: "dca", index: "ndx", watchLimit: true },
  { code: "096001", name: "大成标普500等权重指数(QDII)A人民币", group: "dca", index: "spxew", watchLimit: true },
  { code: "008701", name: "华夏黄金ETF联接A", group: "dca", index: "gold" },
  { code: "008702", name: "华夏黄金ETF联接C", group: "dca", index: "gold", tag: "继续持有" },
  // 个人养老金
  { code: "022930", name: "易方达中证A500ETF联接Y", group: "pension", index: "a500" },
  { code: "022918", name: "南方中证A500ETF联接Y", group: "pension", index: "a500" },
  { code: "022928", name: "易方达沪深300ETF联接Y", group: "pension", index: "csi300" },
  // 以后再买
  { code: "022459", name: "易方达中证A500ETF联接A", group: "later", index: "a500", tag: "A股宽基 · 首选", watchLimit: true },
  { code: "022434", name: "南方中证A500ETF联接A", group: "later", index: "a500", tag: "A股宽基 · 备选", watchLimit: true },
  { code: "110020", name: "易方达沪深300ETF联接A", group: "later", index: "csi300", tag: "A股宽基 · 备选", watchLimit: true },
  { code: "007466", name: "华泰柏瑞中证红利低波ETF联接A", group: "later", index: "divlowvol", tag: "红利", watchLimit: true },
  { code: "110051", name: "易方达安和中短债A", group: "later", index: "cnbond", tag: "固收", watchLimit: true },
  { code: "050025", name: "博时标普500ETF联接A", group: "later", index: "spx", tag: "海外", watchLimit: true },
  { code: "510300", name: "华泰柏瑞沪深300ETF", group: "later", index: "csi300", etf: true, watchPremium: true },
  { code: "512890", name: "华泰柏瑞红利低波ETF", group: "later", index: "divlowvol", etf: true, watchPremium: true },
  { code: "518850", name: "华夏黄金ETF", group: "later", index: "gold", etf: true, watchPremium: true },
  { code: "518880", name: "华安黄金ETF", group: "later", index: "gold", etf: true, tag: "对比", watchPremium: true },
  { code: "513500", name: "博时标普500ETF", group: "later", index: "spx", etf: true, watchPremium: true },
  { code: "513100", name: "国泰纳斯达克100ETF", group: "later", index: "ndx", etf: true, watchPremium: true },
];

export type Market = "us" | "cn" | "gold" | "bond";

export interface IndexConfig {
  id: IndexId;
  name: string;
  market: Market;
  /** 东方财富 secid of the daily series shown for the index. */
  secid: string;
  /** 腾讯行情 symbol of the same series, used when 东方财富 does not answer. */
  tencent?: string;
  /** Set when `secid` is a stand-in, e.g. an ETF that tracks an index with no free quote. */
  proxy?: string;
  /** The series is a yield in percent: changes are shown in basis points. */
  yieldSeries?: boolean;
  /** PE/PB source: 蛋卷基金 index code, or 中证指数 index code (PE only). */
  valuation?: { source: "danjuan" | "csindex"; code: string };
  unit?: string;
  decimals: number;
}

export const INDICES: IndexConfig[] = [
  { id: "ndx", name: "纳斯达克100", market: "us", secid: "100.NDX100", tencent: "us.NDX", valuation: { source: "danjuan", code: "NDX" }, decimals: 2 },
  { id: "spx", name: "标普500", market: "us", secid: "100.SPX", tencent: "us.INX", valuation: { source: "danjuan", code: "SP500" }, decimals: 2 },
  { id: "spxew", name: "标普500等权重", market: "us", secid: "107.RSP", tencent: "us.RSP", proxy: "用跟踪该指数的 RSP ETF 价格近似", unit: "美元", decimals: 2 },
  { id: "a500", name: "中证A500", market: "cn", secid: "1.000510", tencent: "sh000510", valuation: { source: "csindex", code: "000510" }, decimals: 2 },
  { id: "csi300", name: "沪深300", market: "cn", secid: "1.000300", tencent: "sh000300", valuation: { source: "danjuan", code: "SH000300" }, decimals: 2 },
  { id: "divlowvol", name: "中证红利低波动", market: "cn", secid: "2.H30269", valuation: { source: "danjuan", code: "CSIH30269" }, decimals: 2 },
  { id: "gold", name: "黄金9999", market: "gold", secid: "118.AU9999", unit: "元/克", decimals: 2 },
  { id: "cnbond", name: "中国10年期国债收益率", market: "bond", secid: "171.CN10Y", proxy: "中短债基金没有跟踪指数，用长端利率作参考", yieldSeries: true, unit: "%", decimals: 2 },
];

export type MacroId = "xau" | "shau" | "dxy" | "us10y" | "real10y" | "usdcnh";

export interface MacroConfig {
  id: MacroId;
  name: string;
  /** 东方财富 secid, or the US Treasury daily real yield curve (10-year). */
  source: { kind: "eastmoney"; secid: string } | { kind: "treasury-real" };
  yieldSeries?: boolean;
  unit?: string;
  decimals: number;
}

/** Drivers shown next to the indices; the first two are the gold prices. */
export const MACRO: MacroConfig[] = [
  { id: "xau", name: "现货黄金", source: { kind: "eastmoney", secid: "122.XAU" }, unit: "美元/盎司", decimals: 2 },
  { id: "shau", name: "上海金", source: { kind: "eastmoney", secid: "118.SHAU" }, unit: "元/克", decimals: 2 },
  { id: "dxy", name: "美元指数", source: { kind: "eastmoney", secid: "100.UDI" }, decimals: 2 },
  { id: "us10y", name: "美债10年期收益率", source: { kind: "eastmoney", secid: "171.US10Y" }, yieldSeries: true, unit: "%", decimals: 2 },
  { id: "real10y", name: "美债10年期实际利率", source: { kind: "treasury-real" }, yieldSeries: true, unit: "%", decimals: 2 },
  { id: "usdcnh", name: "美元/离岸人民币", source: { kind: "eastmoney", secid: "133.USDCNH" }, decimals: 4 },
];

export const INVEST_RULES = {
  /** 场内 QDII ETF premium in percent: below `low` is worth a reminder; from `low` up the rule is not to buy. */
  premium: { low: 2, high: 3 },
  /** Domestic ETFs trade within a few tenths of NAV; a premium or discount this large (percent) is flagged. */
  domesticPremium: { unusual: 1 },
  /** Yearly management + custody fee caps for index funds, in percent. */
  feeCap: { domestic: 0.2, domesticTolerance: 0.05, qdii: 1 },
  /** The debit-check reminder shows on the first days of each month. */
  monthlyCheckDays: 7,
} as const;

export const INVEST_SITE = {
  name: "投资日报",
  tagline: "定投基金 · 指数 · 黄金 · 宏观要闻，每天两次更新",
  disclaimer: "本页只汇总公开行情与新闻，提醒按页面设定的规则自动生成，不构成投资建议。",
  /** Change events stay in the alert panel this long. */
  alertDays: 7,
  /** Stored news older than this is dropped. */
  newsDays: 7,
  calendarDays: 14,
} as const;
