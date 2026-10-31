/**
 * 投资日报的配置：关注的基金、它们跟踪的指数、宏观指标和提醒规则。
 *
 * 仓库和网页都是公开的：这里只放基金名称、代码、公开行情的代码和规则阈值，
 * 不放任何金额、配置比例或个人日期。
 *
 * - 换基金：增删 FUNDS 里的一行。`index` 指向 INDICES 里的一项，决定显示哪条指数行情、估值和相关新闻。
 * - 新指数：在 INDICES 加一行（东方财富 secid 可在 quote.eastmoney.com 的网址里找到）。
 */

export type FundGroup = "dca" | "pension" | "later" | "groupA" | "groupB";

export const FUND_GROUPS: { id: FundGroup; label: string; hint: string }[] = [
  { id: "dca", label: "正在定投", hint: "净值、跟踪指数、申购状态与费率" },
  { id: "pension", label: "个人养老金", hint: "中证A500 / 沪深300 的 Y 份额候选" },
  { id: "later", label: "以后再买", hint: "场外基金与场内 ETF" },
  { id: "groupA", label: "A组", hint: "净值、跟踪指数、申购状态与费率" },
  { id: "groupB", label: "B组", hint: "净值、跟踪指数、申购状态与费率" },
];

/** Groups whose 定投 plans the alerts refer to; the other groups get neutral wording. */
export const PLAN_GROUPS: FundGroup[] = ["dca", "pension", "later"];

/** How a fund is used, which decides the wording of suggestions: 定投 now, held without buying more, or planned. */
export type FundRole = "dca" | "held" | "planned";

export const GROUP_ROLE: Record<FundGroup, FundRole> = { dca: "dca", pension: "planned", later: "planned", groupA: "held", groupB: "held" };

export type IndexId = "ndx" | "spx" | "spxew" | "a500" | "csi300" | "cicc300" | "divlowvol" | "gold" | "cnbond";

export interface FundConfig {
  code: string;
  /** Fallback name; the name 天天基金 returns is shown when available. */
  name: string;
  group: FundGroup;
  /** Tracked index; for active and bond funds, the card whose market news fits them. */
  index: IndexId;
  /** On-exchange ETF: shows the traded price and, for QDII, the premium. */
  etf?: boolean;
  /** LOF: bought at NAV off-exchange, also traded on the exchange; shows both and the premium. */
  lof?: boolean;
  /** Short label next to the name. */
  tag?: string;
  /** Alert when the purchase status or the daily purchase limit changes. */
  watchLimit?: boolean;
  /**
   * Show the premium over NAV in the alert panel. QDII ETFs get the 2% / 2–3% rule; domestic ETFs are
   * flagged only when the premium or discount is unusual.
   */
  watchPremium?: boolean;
  /** Overrides the group's role, e.g. C shares still held after their 定投 stopped. */
  role?: FundRole;
  /** QDII fund whose quota reopening or rising is the cue to add to the overseas part (可以加大). */
  addOnReopen?: boolean;
}

export const FUNDS: FundConfig[] = [
  // 正在定投
  { code: "019172", name: "摩根纳斯达克100指数(QDII)人民币A", group: "dca", index: "ndx", watchLimit: true, addOnReopen: true },
  { code: "016452", name: "南方纳斯达克100指数发起(QDII)A", group: "dca", index: "ndx", watchLimit: true, addOnReopen: true },
  { code: "096001", name: "大成标普500等权重指数(QDII)A人民币", group: "dca", index: "spxew", watchLimit: true, addOnReopen: true },
  { code: "008701", name: "华夏黄金ETF联接A", group: "dca", index: "gold" },
  { code: "008702", name: "华夏黄金ETF联接C", group: "dca", index: "gold", tag: "继续持有", role: "held" },
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
  { code: "050025", name: "博时标普500ETF联接A", group: "later", index: "spx", tag: "海外", watchLimit: true, addOnReopen: true },
  { code: "510300", name: "华泰柏瑞沪深300ETF", group: "later", index: "csi300", etf: true, watchPremium: true },
  { code: "512890", name: "华泰柏瑞红利低波ETF", group: "later", index: "divlowvol", etf: true, watchPremium: true },
  { code: "518850", name: "华夏黄金ETF", group: "later", index: "gold", etf: true, watchPremium: true },
  { code: "518880", name: "华安黄金ETF", group: "later", index: "gold", etf: true, tag: "对比", watchPremium: true },
  { code: "513500", name: "博时标普500ETF", group: "later", index: "spx", etf: true, watchPremium: true },
  { code: "513100", name: "国泰纳斯达克100ETF", group: "later", index: "ndx", etf: true, watchPremium: true },
  // A组
  { code: "006672", name: "广发招财短债债券A", group: "groupA", index: "cnbond", watchLimit: true },
  { code: "501060", name: "中金中证优选300指数(LOF)A", group: "groupA", index: "cicc300", lof: true, watchLimit: true, watchPremium: true },
  { code: "022502", name: "国泰黄金ETF联接E", group: "groupA", index: "gold", watchLimit: true },
  // B组（021277 是主动管理的 QDII，没有跟踪指数，挂在标普500 下只为相关新闻）
  { code: "015530", name: "鹏华稳福中短债债券A", group: "groupB", index: "cnbond", watchLimit: true },
  { code: "021277", name: "广发全球精选股票(QDII)人民币C", group: "groupB", index: "spx", watchLimit: true },
  { code: "000218", name: "国泰黄金ETF联接A", group: "groupB", index: "gold", watchLimit: true },
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
  /** 中证指数 code: its published closes stand in when the quote sources fail. */
  csindex?: string;
  /** 新浪 quote symbol for the latest value when the others fail (see SINA_FIELDS in sources/market.ts). */
  sina?: string;
  /** Set when `secid` is a stand-in, e.g. an ETF that tracks an index with no free quote. */
  proxy?: string;
  /** The series is a yield in percent: changes are shown in basis points. */
  yieldSeries?: boolean;
  /**
   * PE/PB source: 蛋卷基金 index code, or 中证指数 index code (PE, with a percentile when its PE history covers
   * five years; its daily closes also stand in when the quote sources fail).
   */
  valuation?: { source: "danjuan" | "csindex"; code: string };
  /**
   * Names of other funds on the index in 天天基金's fund list, for the weekly comparison; matches are kept only
   * when their 跟踪标的 is the tracked funds' own (gold: Au99.99, the same metal).
   */
  peers?: RegExp;
  unit?: string;
  decimals: number;
}

export const INDICES: IndexConfig[] = [
  // 腾讯's "us.NDX" is a stock, not the index; usNDX and usRSP give only the latest day, which is added to the stored history.
  { id: "ndx", name: "纳斯达克100", market: "us", secid: "100.NDX100", tencent: "usNDX", valuation: { source: "danjuan", code: "NDX" }, peers: /纳斯达克100|纳指100/, decimals: 2 },
  { id: "spx", name: "标普500", market: "us", secid: "100.SPX", tencent: "us.INX", valuation: { source: "danjuan", code: "SP500" }, peers: /标普500/, decimals: 2 },
  { id: "spxew", name: "标普500等权重", market: "us", secid: "107.RSP", tencent: "usRSP", proxy: "用跟踪该指数的 RSP ETF 价格近似", peers: /标普500等权/, unit: "美元", decimals: 2 },
  { id: "a500", name: "中证A500", market: "cn", secid: "1.000510", tencent: "sh000510", csindex: "000510", valuation: { source: "csindex", code: "000510" }, peers: /A500/, decimals: 2 },
  { id: "csi300", name: "沪深300", market: "cn", secid: "1.000300", tencent: "sh000300", csindex: "000300", valuation: { source: "danjuan", code: "SH000300" }, peers: /沪深300(?:ETF|指数|联接|[A-Z]$)/, decimals: 2 },
  { id: "cicc300", name: "中证中金优选300", market: "cn", secid: "2.931069", csindex: "931069", valuation: { source: "csindex", code: "931069" }, peers: /优选300/, decimals: 2 },
  { id: "divlowvol", name: "中证红利低波动", market: "cn", secid: "2.H30269", csindex: "H30269", valuation: { source: "danjuan", code: "CSIH30269" }, peers: /中证红利低波|红利低波(?:动)?ETF/, decimals: 2 },
  { id: "gold", name: "黄金9999", market: "gold", secid: "118.AU9999", sina: "SGE_AU9999", peers: /黄金(?:ETF|9999|现货)|上海金/, unit: "元/克", decimals: 2 },
  { id: "cnbond", name: "中国10年期国债收益率", market: "bond", secid: "171.CN10Y", sina: "globalbd_cn10yt", proxy: "中短债基金没有跟踪指数，用长端利率作参考", yieldSeries: true, unit: "%", decimals: 2 },
];

export type MacroId = "xau" | "shau" | "dxy" | "us10y" | "real10y" | "usdcnh";

export interface MacroConfig {
  id: MacroId;
  name: string;
  /** 东方财富 secid, or the US Treasury daily real yield curve (10-year). */
  source: { kind: "eastmoney"; secid: string } | { kind: "treasury-real" };
  /** 新浪 quote symbol for the latest value when 东方财富 fails. */
  sina?: string;
  yieldSeries?: boolean;
  unit?: string;
  decimals: number;
}

/** Drivers shown next to the indices; the first two are the gold prices. */
export const MACRO: MacroConfig[] = [
  { id: "xau", name: "现货黄金", source: { kind: "eastmoney", secid: "122.XAU" }, sina: "hf_XAU", unit: "美元/盎司", decimals: 2 },
  { id: "shau", name: "上海金", source: { kind: "eastmoney", secid: "118.SHAU" }, unit: "元/克", decimals: 2 },
  { id: "dxy", name: "美元指数", source: { kind: "eastmoney", secid: "100.UDI" }, sina: "DINIW", decimals: 2 },
  { id: "us10y", name: "美债10年期收益率", source: { kind: "eastmoney", secid: "171.US10Y" }, yieldSeries: true, unit: "%", decimals: 2 },
  { id: "real10y", name: "美债10年期实际利率", source: { kind: "treasury-real" }, yieldSeries: true, unit: "%", decimals: 2 },
  { id: "usdcnh", name: "美元/离岸人民币", source: { kind: "eastmoney", secid: "133.USDCNH" }, sina: "fx_susdcnh", decimals: 4 },
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
  /** Weekly comparison with other off-exchange funds on the same index (gold: the same metal). */
  alternatives: {
    /** All-in yearly fee saving (management + custody + sales service) worth suggesting, percent. */
    minSaving: 0.1,
    /** Net assets across all share classes, yuan. */
    minSize: 2e8,
    /** Younger funds are still suggested, marked 成立不满一年. */
    minHistoryDays: 365,
    /** A QDII daily limit this many times the current one is meaningfully higher… */
    quotaFactor: 5,
    /** …and at least this much a day (yuan) when the current fund is paused. */
    minQuota: 100,
    /** Daily limits from this amount up count as no limit. */
    noLimit: 1e6,
  },
  /** Stop signals, checked every run. */
  stop: {
    /** Below this size (yuan) a fund may be liquidated (清盘). */
    minSize: 5e7,
    /** Annualized tracking error clearly out of line for the fund's kind, percent. */
    trackingError: { qdii: 4, domestic: 2.5, etf: 2 },
    /** Material announcements (清盘, 转型, 合并, new benchmark) stay relevant this long. */
    noticeDays: 60,
  },
} as const;

export const INVEST_SITE = {
  name: "投资日报",
  tagline: "定投基金 · 指数 · 黄金 · 宏观要闻，每天两次更新",
  disclaimer: "本页汇总公开行情与新闻；提醒和策略建议按页面设定的规则自动生成，仅供参考，不构成投资建议。",
  /** Change events stay in the alert panel this long. */
  alertDays: 7,
  /** Stored news older than this is dropped. */
  newsDays: 7,
  calendarDays: 14,
} as const;
