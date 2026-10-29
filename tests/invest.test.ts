import { describe, expect, it, vi } from "vitest";
import { FUNDS } from "@/config/invest";
import { INVEST_SOURCES } from "@/config/invest-news";
import { compareStatus, diffAlerts } from "@/lib/invest/alerts";
import { checkFeeRule, computePremium, premiumBand, weekChange } from "@/lib/invest/funds";
import { INVEST_CLUSTER_WINDOW_MS, mergeNews, rankNews, toInvestItem } from "@/lib/invest/news";
import { buildAutoOverview, generateAiOverview, translateHeadlines } from "@/lib/invest/overview";
import { investTopics, isCompanyFiling } from "@/lib/invest/topics";
import type { FundView, InvestNewsItem, QuoteView } from "@/lib/invest/types";
import { LlmClient, summarizeItems, type LlmConfig } from "@/lib/pipeline/llm";

const NOW = new Date("2026-10-29T11:30:00Z");
const source = (id: string) => INVEST_SOURCES.find((s) => s.id === id)!;
const zh = (title: string, excerpt?: string) => investTopics(title, excerpt, { sourceId: "em-focus", lang: "zh" });

describe("topics", () => {
  it("tags central banks, data, markets and gold", () => {
    expect(zh("央行今日开展1150亿元7天期逆回购操作")).toContain("pboc");
    expect(zh("美联储维持利率不变")).toContain("fed");
    expect(zh("10月官方制造业PMI为50.1，国家统计局公布")).toContain("macro-cn");
    expect(zh("美国10月非农就业人口增加6.5万人")).toContain("macro-us");
    expect(zh("创业板指跌逾2% 下跌个股近3800只")).toContain("a-shares");
    expect(zh("现货黄金日内跌1%，失守4000美元")).toContain("gold");
    expect(zh("中国10月末黄金储备报7406万盎司，连续第12个月增持黄金")).toContain("cb-gold");
    expect(zh("多只QDII基金暂停申购")).toContain("qdii");
  });

  it("does not read other countries' central banks, bonds or a London district as China or gold news", () => {
    expect(zh("英国9月央行消费信贷 19.14亿英镑，预期 20亿英镑")).toEqual([]);
    expect(zh("韩国11月再度缩减国债发行规模", "韩国本月已大幅削减国债发行，监管机构意在缓解债市供给压力")).toEqual([]);
    expect(zh("报道：英国银行税上调据悉将是暂时性的", "希利在预算案中寻求维护伦敦金融城竞争力")).toEqual([]);
    expect(zh("美国禁止进口三家中国生物技术公司产品")).not.toContain("macro-cn");
  });

  it("drops company filings but keeps the largest US tech results", () => {
    expect(isCompanyFiling("江苏银行：第三季度归母净利润112.19亿元，同比增长8.46%")).toBe(true);
    expect(isCompanyFiling("中国诚通Q3新进成为中金黄金第七大股东")).toBe(true);
    expect(isCompanyFiling("中国人民银行：三季度末普惠小微贷款余额38.50万亿元")).toBe(false);
    expect(isCompanyFiling("微软：第一财季营收922.8亿美元")).toBe(false);
  });

  it("treats English outlets as US news unless another economy is named", () => {
    const en = (title: string) => investTopics(title, undefined, { sourceId: "cnbc-economy", lang: "en" });
    expect(en("Payrolls rose 65,000 in October as unemployment held at 4.2%")).toContain("macro-us");
    expect(en("Is it curtains for COLA? Saving Social Security could mean cutting inflation adjustments")).toEqual([]);
    expect(en("UK GDP grew 0.1% in the third quarter")).not.toContain("macro-us");
  });
});

describe("premium and fees", () => {
  it("compares the close with the NAV at the last US close before it", () => {
    const p = computePremium([["2026-10-28", 2.702], ["2026-10-29", 2.688]], [{ date: "2026-10-28", nav: 2.4597 }], [["2026-10-27", 7722.6], ["2026-10-28", 7743.98]]);
    expect(p).toMatchObject({ value: 9.28, band: "high", navDate: "2026-10-28", estimated: false });
  });

  it("moves an older NAV forward by the index and exchange-rate change", () => {
    const p = computePremium(
      [["2026-10-29", 2.29]],
      [{ date: "2026-10-27", nav: 1.9836 }],
      [["2026-10-27", 29651.44], ["2026-10-28", 29813.16]],
      [["2026-10-27", 6.6647], ["2026-10-28", 6.6615]],
    );
    expect(p?.estimated).toBe(true);
    expect(p?.value).toBeCloseTo((2.29 / (1.9836 * (29813.16 / 29651.44) * (6.6615 / 6.6647)) - 1) * 100, 1);
  });

  it("bands premiums at 2% and 3%", () => {
    expect([premiumBand(1.6), premiumBand(2.4), premiumBand(9.3)]).toEqual(["low", "mid", "high"]);
  });

  it("applies the fee rule: QDII within 1%, A shares and gold about 0.2%, bond funds not checked", () => {
    const fund = (code: string) => FUNDS.find((f) => f.code === code)!;
    expect(checkFeeRule(fund("096001"), { code: "096001", type: "指数型-海外股票", updatedAt: "" }, { management: 1, custody: 0.2 })).toMatchObject({ kind: "qdii", total: 1.2, ok: false });
    expect(checkFeeRule(fund("019172"), { code: "019172", type: "指数型-海外股票", updatedAt: "" }, { management: 0.5, custody: 0.1 })?.ok).toBe(true);
    expect(checkFeeRule(fund("007466"), { code: "007466", type: "指数型-股票", updatedAt: "" }, { management: 0.5, custody: 0.1 })).toMatchObject({ kind: "domestic", ok: false });
    expect(checkFeeRule(fund("008701"), { code: "008701", type: "指数型-其他", updatedAt: "" }, { management: 0.15, custody: 0.05 })?.ok).toBe(true);
    expect(checkFeeRule(fund("110051"), { code: "110051", type: "债券型-中短债", name: "易方达安和中短债A", updatedAt: "" }, { management: 0.2, custody: 0.05 })).toBeUndefined();
  });

  it("measures the change over about a week", () => {
    expect(weekChange([{ date: "2026-10-20", value: 100 }, { date: "2026-10-22", value: 101 }, { date: "2026-10-29", value: 103 }])).toBe(1.98);
    expect(weekChange([{ date: "2026-10-27", value: 100 }, { date: "2026-10-29", value: 103 }])).toBeUndefined();
  });
});

describe("alerts", () => {
  const view = (code: string, extra: Partial<FundView> = {}): FundView => ({
    code,
    name: code,
    group: "dca",
    etf: false,
    index: "ndx",
    indexName: "纳斯达克100",
    watchLimit: true,
    watchPremium: false,
    ...extra,
  });
  const status = (purchase: string, limit?: number | null, dca = "支持") => ({ purchase, limit, dca, asOf: NOW.toISOString() });

  it("ranks status changes: paused or lower limits are down, reopened or higher are up", () => {
    expect(compareStatus({ purchase: "限大额", limit: 50, at: "" }, { purchase: "限大额", limit: 10 })).toBe("down");
    expect(compareStatus({ purchase: "限大额", limit: 10, at: "" }, { purchase: "暂停申购" })).toBe("down");
    expect(compareStatus({ purchase: "暂停申购", at: "" }, { purchase: "限大额", limit: 100 })).toBe("up");
    expect(compareStatus({ purchase: "限大额", limit: 10, at: "" }, { purchase: "开放申购", limit: null })).toBe("up");
    expect(compareStatus({ purchase: "限大额", limit: 10, dca: "支持", at: "" }, { purchase: "限大额", limit: 10, dca: "不支持" })).toBe("down");
    expect(compareStatus({ purchase: "限大额", limit: 10, at: "" }, { purchase: "限大额", limit: 10 })).toBeNull();
  });

  it("records nothing on the first run, then each change once", () => {
    const first = diffAlerts(null, [view("019172", { status: status("限大额", 10), fees: { management: 0.5, custody: 0.1, asOf: "" } })], NOW);
    expect(first.events).toEqual([]);
    const later = new Date(NOW.getTime() + 12 * 3600_000);
    const second = diffAlerts(first, [view("019172", { status: status("限大额", 50), fees: { management: 0.4, custody: 0.1, asOf: "" } })], later);
    expect(second.events.map((e) => [e.kind, e.from, e.to])).toEqual([
      ["limit-up", "限大额 · 10 元/日", "限大额 · 50 元/日"],
      ["fee-change", "管理费 0.5%", "管理费 0.4%"],
    ]);
    const third = diffAlerts(second, [view("019172", { status: status("限大额", 50), fees: { management: 0.4, custody: 0.1, asOf: "" } })], new Date(later.getTime() + 3600_000));
    expect(third.events).toHaveLength(2);
  });

  it("keeps the last-seen state when a fetch fails, so a gap is not a change", () => {
    const first = diffAlerts(null, [view("016452", { status: status("限大额", 10) })], NOW);
    const failed = diffAlerts(first, [view("016452")], new Date(NOW.getTime() + 3600_000));
    expect(failed.lastSeen["016452"]).toMatchObject({ purchase: "限大额", limit: 10 });
    const back = diffAlerts(failed, [view("016452", { status: status("限大额", 10) })], new Date(NOW.getTime() + 7200_000));
    expect(back.events).toEqual([]);
  });

  it("alerts when an ETF premium crosses 2% in either direction", () => {
    const etf = (value: number) =>
      view("513500", { watchLimit: false, watchPremium: true, etf: true, premium: { value, band: premiumBand(value), price: 1, priceDate: "", nav: 1, navDate: "", estimated: false } });
    const a = diffAlerts(null, [etf(9.3)], NOW);
    const b = diffAlerts(a, [etf(2.5)], new Date(NOW.getTime() + 3600_000));
    expect(b.events).toEqual([]);
    const c = diffAlerts(b, [etf(1.8)], new Date(NOW.getTime() + 7200_000));
    expect(c.events.map((e) => e.kind)).toEqual(["premium-low"]);
    const d = diffAlerts(c, [etf(2.2)], new Date(NOW.getTime() + 10_800_000));
    expect(d.events.map((e) => e.kind)).toEqual(["premium-high", "premium-low"]);
  });
});

function newsItem(sourceId: string, title: string, hoursAgo: number, extra: Partial<InvestNewsItem> = {}): InvestNewsItem {
  const item = toInvestItem({ title, url: `https://example.com/${encodeURIComponent(sourceId + title)}`, publishedAt: new Date(NOW.getTime() - hoursAgo * 3600_000).toISOString() }, source(sourceId), NOW)!;
  return { ...item, ...extra };
}

describe("news dedupe and ranking", () => {
  it("merges reports of one decision but keeps the preview and reactions apart", () => {
    const items = [
      newsItem("em-cb", "美联储10月利率决议预判 金融机构预计：美联储或在12月加息25个基点", 14),
      newsItem("em-cb", "美联储维持利率不变", 9.5),
      newsItem("cls", "美联储维持利率不变", 9.5),
      newsItem("em-cb", "美国知名投资人质疑美联储利率决议", 1),
    ];
    const { items: merged } = mergeNews([], items, NOW);
    const cards = merged.filter((i) => !i.dupOf);
    expect(cards).toHaveLength(3);
    expect(cards.find((c) => c.title === "美联储维持利率不变")?.related).toHaveLength(1);
  });

  it("does not merge daily recurring headlines a day apart", () => {
    expect(INVEST_CLUSTER_WINDOW_MS).toBeLessThan(24 * 3600_000);
    const { items } = mergeNews([], [newsItem("cls", "美股三大指数集体收涨", 30), newsItem("wscn-global", "美股三大指数集体收涨", 6)], NOW);
    expect(items.filter((i) => !i.dupOf)).toHaveLength(2);
  });

  it("ranks an important, widely covered central-bank decision above a single market note", () => {
    const decision = [newsItem("fed", "Federal Reserve issues FOMC statement", 3), newsItem("em-cb", "美联储维持利率不变", 3, { flag: 1 }), newsItem("cls", "美联储维持利率不变", 3)];
    const note = newsItem("sina", "A股三大指数集体低开", 2);
    const { items } = mergeNews([], [...decision, note], NOW);
    const ranked = rankNews(items, NOW);
    expect(ranked[0].item.title).toBe("美联储维持利率不变");
  });
});

const quote = (id: string, name: string, last: number, changePct: number, extra: Partial<QuoteView> = {}): QuoteView => ({
  id,
  name,
  last,
  date: "2026-10-28",
  changePct,
  history: [],
  decimals: 2,
  source: "东方财富",
  ...extra,
});

const llmConfig: LlmConfig = {
  apiKey: "k",
  baseUrl: "https://llm.test/v1",
  model: "test-model",
  provider: "test",
  batchSize: 20,
  maxItems: 100,
  maxRequests: 20,
  minIntervalMs: 0,
  timeoutMs: 60_000,
  budgetMs: 600_000,
  extraBody: {},
};

function modelReturning(content: unknown) {
  return vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 }));
}

describe("overview", () => {
  const quotes = {
    us: [quote("ndx", "纳斯达克100", 29813.16, 0.55)],
    cn: [quote("csi300", "沪深300", 4041.84, -1.03, { date: "2026-10-29" })],
    gold: [quote("xau", "现货黄金", 4025.4, -1.03, { unit: "美元/盎司" }), quote("shau", "上海金", 865.31, -0.05, { unit: "元/克" })],
    rates: [quote("real10y", "美债10年期实际利率", 2.67, 0, { yieldSeries: true, changeBp: 3, unit: "%", changePct: undefined })],
  };
  const ranked = rankNews(mergeNews([], [newsItem("cls", "美联储维持利率不变", 3)], NOW).items, NOW);

  it("works without AI from quotes and the top stories", () => {
    const o = buildAutoOverview(quotes, ranked, NOW);
    expect(o.mode).toBe("fallback");
    expect(o.text).toBe(
      "美股（10月28日）：纳斯达克100 涨 0.55%。A股（10月29日）：沪深300 跌 1.03%。黄金：现货 4,025.40 美元/盎司（跌 1.03%），上海金 865.31 元/克。美债10年期实际利率 2.67%（升 3bp）。",
    );
    expect(o.points[0]).toEqual({ text: "美联储维持利率不变", refs: [ranked[0].item.id] });
  });

  it("uses the model's overview but never one that gives advice", async () => {
    const id = ranked[0].item.id;
    const good = new LlmClient(llmConfig, modelReturning({ overview: "美联储按兵不动，美股小涨，A股回调，金价回落。", points: [{ text: "美联储维持利率不变", refs: [id, "x"] }] }) as unknown as typeof fetch);
    const o = await generateAiOverview(good, quotes, ranked, Date.now() + 600_000, NOW);
    expect(o).toMatchObject({ mode: "ai", model: "test-model", points: [{ refs: [id] }] });
    const advice = new LlmClient(llmConfig, modelReturning({ overview: "金价回落，建议逢低买入。", points: [{ text: "美联储维持利率不变", refs: [id] }] }) as unknown as typeof fetch);
    await expect(generateAiOverview(advice, quotes, ranked, Date.now() + 600_000, NOW)).rejects.toThrow("建议");
  });

  it("gives English stories a Chinese title in one request", async () => {
    const item = newsItem("cnbc-economy", "Fed holds rates steady as Warsh signals patience", 2);
    const fetchMock = modelReturning({ items: [{ id: item.id, zh_title: "美联储按兵不动，沃什称将保持耐心", summary: "美联储维持利率不变。" }] });
    const client = new LlmClient(llmConfig, fetchMock as unknown as typeof fetch);
    expect(await translateHeadlines(client, [item], Date.now() + 600_000)).toBe(1);
    expect(item.ai?.title).toBe("美联储按兵不动，沃什称将保持耐心");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("shared AI budget", () => {
  it("summaries leave the requests the 投资日报 needs", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[]}' } }] }), { status: 200 }));
    const client = new LlmClient({ ...llmConfig, maxRequests: 10, batchSize: 1 }, fetchMock as unknown as typeof fetch);
    const items = Array.from({ length: 10 }, (_, i) => ({ ...newsItem("cls", `央行今日开展逆回购操作 ${i}`, 1), id: `i${i}` }));
    const outcome = await summarizeItems(client, items, { deadline: Date.now() + 600_000, followUps: 7 });
    expect(client.requests).toBe(3);
    expect(outcome.stop?.kind).toBe("limit");
  });
});
