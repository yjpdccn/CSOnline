import { describe, expect, it } from "vitest";
import { FUNDS, INDICES } from "@/config/invest";
import { parseFundUniverse, parseNotices, parseProfilePage, parseTrackingError, shareClass, type UniverseFund } from "@/lib/invest/sources/funds";
import { candidatesFor, emptyStrategy, refreshStrategy, scanDue, scanPeers, type PeerFund, type StrategyFile } from "@/lib/invest/strategy";
import { allIn, buildSuggestions, capacity, NOTE } from "@/lib/invest/suggestions";
import type { AlertEvent, FundsFile, FundView } from "@/lib/invest/types";

// Saturday 19:00 in Beijing.
const NOW = new Date("2026-10-31T11:00:00Z");

describe("天天基金 pages for the comparison", () => {
  it("reads inception, size and fees from 基本概况", () => {
    const html = `<table>
      <tr><th>基金简称</th><td>华夏黄金ETF联接A</td><th>基金类型</th><td>指数型-其他</td></tr>
      <tr><th>成立日期/规模</th><td>2020年07月16日 / 1.219亿份</td><th>净资产规模</th><td>28.47亿元（截止至：2026年09月30日）</td></tr>
      <tr><th>管理费率</th><td>0.15%（每年）</td><th>托管费率</th><td>0.05%（每年）</td></tr>
      <tr><th>销售服务费率</th><td>0.00%（每年）</td><th>跟踪标的</th><td>黄金9999</td></tr></table>`;
    expect(parseProfilePage(html)).toEqual({
      name: "华夏黄金ETF联接A",
      type: "指数型-其他",
      index: "黄金9999",
      established: "2020-07-16",
      size: 2_847_000_000,
      sizeDate: "2026-09-30",
      fees: { management: 0.15, custody: 0.05, service: 0 },
    });
  });

  it("reads the annualized tracking error from 特色数据", () => {
    const html = `<table class="fxtb"><tr><th>跟踪指数</th><th>年化跟踪误差</th><th>同类平均跟踪误差</th></tr><tr><td>纳斯达克100指数</td><td>2.29%</td><td>2.24%</td></tr></table>`;
    expect(parseTrackingError(html)).toBe(2.29);
    expect(parseTrackingError("<table><tr><th>标准差</th></tr></table>")).toBeUndefined();
  });

  it("keeps announcements that can end or change a fund, not sales-agent notices", () => {
    const row = (TITLE: string) => ({ TITLE, PUBLISHDATEDesc: "2026-10-20", ID: TITLE.length.toString() + TITLE.slice(-4) });
    const notices = parseNotices({
      Data: [
        row("关于XX纳斯达克100指数基金可能触发基金合同终止情形的提示性公告"),
        row("关于以通讯方式召开XX基金份额持有人大会的公告"),
        row("关于XX指数基金变更业绩比较基准并修改基金合同的公告"),
        row("摩根基金管理(中国)有限公司关于终止瑞银基金销售(深圳)有限公司办理旗下基金相关销售业务的公告"),
        row("关于XX基金调整大额申购(含定期定额投资)业务的公告"),
        row("XX基金2026年第3季度报告"),
      ],
    });
    expect(notices.map((n) => n.title)).toEqual([
      "关于XX纳斯达克100指数基金可能触发基金合同终止情形的提示性公告",
      "关于以通讯方式召开XX基金份额持有人大会的公告",
      "关于XX指数基金变更业绩比较基准并修改基金合同的公告",
    ]);
    expect(() => parseNotices({ Data: null })).toThrow();
  });

  it("reads the fund list and tells share classes apart", () => {
    const rows = Array.from({ length: 1200 }, (_, i) => `["${String(100000 + i)}","X","基金${i}","混合型-偏股","X"]`).join(",");
    expect(parseFundUniverse(`var r = [["008701","HXHJ","华夏黄金ETF联接A","指数型-其他","HUAXIA"],${rows}];`)[0]).toEqual({ code: "008701", name: "华夏黄金ETF联接A", type: "指数型-其他" });
    expect(shareClass("摩根纳斯达克100指数(QDII)人民币A")).toEqual({ stem: "摩根纳斯达克100指数(QDII)", cls: "A", usd: false });
    expect(shareClass("大成标普500等权重指数(QDII)A人民币")).toMatchObject({ cls: "A" });
    expect(shareClass("华夏标普500ETF发起式联接(QDII)A(人民币)")).toMatchObject({ stem: "华夏标普500ETF发起式联接(QDII)", cls: "A" });
    expect(shareClass("易方达纳斯达克100ETF联接(QDII-LOF)A(美元现汇)")).toMatchObject({ cls: "A", usd: true });
    expect(shareClass("易方达中证A500ETF联接Y")).toMatchObject({ cls: "Y" });
    expect(shareClass("国泰纳斯达克100指数")).toMatchObject({ cls: "" });
    expect(shareClass("华夏黄金ETF联接C").stem).toBe(shareClass("华夏黄金ETF联接A").stem);
  });
});

const universe: UniverseFund[] = [
  { code: "008701", name: "华夏黄金ETF联接A", type: "指数型-其他" },
  { code: "008702", name: "华夏黄金ETF联接C", type: "指数型-其他" },
  { code: "000218", name: "国泰黄金ETF联接A", type: "指数型-其他" },
  { code: "022502", name: "国泰黄金ETF联接E", type: "指数型-其他" },
  { code: "002610", name: "博时黄金ETF联接A", type: "指数型-其他" },
  { code: "008142", name: "工银黄金ETF联接A", type: "指数型-其他" },
  { code: "518880", name: "黄金ETF华安", type: "指数型-其他" },
  { code: "000216", name: "华安黄金ETF联接A(后端)", type: "指数型-其他" },
  { code: "270023", name: "广发全球精选股票(QDII)人民币A", type: "QDII-普通股票" },
  { code: "021277", name: "广发全球精选股票(QDII)人民币C", type: "QDII-普通股票" },
  { code: "019999", name: "某某纳斯达克100指数增强A", type: "指数型-海外股票" },
  { code: "018888", name: "某某纳斯达克100ETF联接(QDII)A美元", type: "指数型-海外股票" },
];

describe("weekly comparison", () => {
  it("picks off-exchange funds of the wanted classes, without 增强, USD classes or back-end codes", () => {
    const gold = INDICES.find((i) => i.id === "gold")!.peers!;
    expect(candidatesFor(universe, gold, new Set(["A"])).map((f) => f.code)).toEqual(["008701", "000218", "002610", "008142"]);
    expect(candidatesFor(universe, /纳斯达克100/, new Set(["A"]))).toEqual([]);
  });

  it("runs on Sundays and when the last scan is missing or over a week old", () => {
    expect(scanDue(emptyStrategy(), NOW)).toBe(true);
    expect(scanDue({ ...emptyStrategy(), checkedAt: "2026-10-30T11:00:00Z" }, NOW)).toBe(false);
    expect(scanDue({ ...emptyStrategy(), checkedAt: "2026-10-31T11:00:00Z" }, new Date("2026-11-01T00:00:00Z"))).toBe(false);
    expect(scanDue({ ...emptyStrategy(), checkedAt: "2026-10-30T11:00:00Z" }, new Date("2026-11-01T00:00:00Z"))).toBe(true);
    expect(scanDue({ ...emptyStrategy(), checkedAt: "2026-10-22T11:00:00Z" }, NOW)).toBe(true);
  });

  it("keeps same-index funds within the fee rule, adds up share classes and reads statuses", async () => {
    const funds: FundsFile = { updatedAt: "", funds: {} };
    for (const code of ["008701", "008702", "000218", "022502"]) funds.funds[code] = { code, updatedAt: "", tracking: { index: "黄金9999", asOf: "" } };
    funds.funds["008701"].status = { purchase: "限大额", limit: 75_000_000, asOf: "x" };
    funds.funds["021277"] = { code: "021277", updatedAt: "", name: "广发全球精选股票(QDII)人民币C", fees: { management: 1.2, custody: 0.2, service: 0.6, asOf: "" } };
    const profiles: Record<string, ReturnType<typeof parseProfilePage>> = {
      "008701": { name: "华夏黄金ETF联接A", index: "黄金9999", established: "2020-07-16", size: 28.5e8, fees: { management: 0.15, custody: 0.05, service: 0 } },
      "008702": { name: "华夏黄金ETF联接C", index: "黄金9999", size: 58.3e8, fees: { management: 0.15, custody: 0.05, service: 0.35 } },
      "000218": { name: "国泰黄金ETF联接A", index: "黄金9999", size: 136e8, fees: { management: 0.5, custody: 0.1, service: 0 } },
      "022502": { name: "国泰黄金ETF联接E", index: "黄金9999", size: 177e8, fees: { management: 0.5, custody: 0.1, service: 0.3 } },
      "002610": { name: "博时黄金ETF联接A", index: "黄金9999", size: 52e8, fees: { management: 0.5, custody: 0.1, service: 0 } },
      "008142": { name: "工银黄金ETF联接A", index: "黄金9999", size: 1e8, established: "2020-05-21", fees: { management: 0.15, custody: 0.05, service: 0 } },
      "270023": { name: "广发全球精选股票(QDII)人民币A", size: 300e8, established: "2010-08-18", fees: { management: 1.2, custody: 0.2, service: 0 } },
      "021277": { name: "广发全球精选股票(QDII)人民币C", size: 89e8, fees: { management: 1.2, custody: 0.2, service: 0.6 } },
    };
    const read: string[] = [];
    const scan = await scanPeers(funds, NOW, {
      universe: async () => universe,
      profile: async (code) => profiles[code] ?? { name: FUNDS.find((f) => f.code === code)?.name ?? code },
      feePage: async (code) => (read.push(code), { status: { purchase: "开放申购", limit: null }, fees: {} }),
      trackingError: async (code) => (code === "008701" ? 1.09 : undefined),
    });
    expect(scan.file.peers["黄金9999"].map((p) => [p.code, p.size, p.status?.purchase])).toEqual([["008701", 86.8e8, "限大额"]]);
    expect(scan.file.peers["same:021277"].map((p) => [p.code, p.size])).toEqual([["270023", 389e8]]);
    expect(read).toEqual(["270023"]);
    expect(scan.file.tracked["008702"]).toMatchObject({ size: 86.8e8 });
    expect(scan.file.tracked["008701"].trackingError).toBe(1.09);
    expect(scan.result).toMatchObject({ id: "fund-peers", ok: true, count: 2 });
  });

  it("rereads announcements and overseas quotas every run", async () => {
    const file: StrategyFile = {
      ...emptyStrategy(),
      peers: { 纳斯达克100指数: [{ code: "019736", name: "宝盈纳斯达克100指数发起(QDII)A人民币", cls: "A", qdii: true, fees: {}, status: { purchase: "暂停申购", asOf: "" } }] },
    };
    const next = await refreshStrategy(file, NOW, {
      notices: async (code) => (code === "007466" ? [{ id: "a", title: "基金合同终止", date: "2026-10-20" }, { id: "b", title: "持有人大会", date: "2026-06-01" }] : []),
      feePage: async () => ({ status: { purchase: "限大额", limit: 1000 }, fees: {} }),
    });
    expect(next.file.notices["007466"].map((n) => n.id)).toEqual(["a"]);
    expect(next.file.peers["纳斯达克100指数"][0].status).toMatchObject({ purchase: "限大额", limit: 1000 });
    expect(file.peers["纳斯达克100指数"][0].status?.purchase).toBe("暂停申购");
    expect(next.results.map((r) => [r.id, r.ok])).toEqual([
      ["fund-notices", true],
      ["peer-status", true],
    ]);
  });
});

const status = (purchase: string, limit?: number | null, dca = "支持") => ({ purchase, limit, dca, asOf: "" });

function view(code: string, extra: Partial<FundView> = {}): FundView {
  const fund = FUNDS.find((f) => f.code === code)!;
  const index = INDICES.find((i) => i.id === fund.index)!;
  return {
    code,
    name: fund.name,
    group: fund.group,
    etf: Boolean(fund.etf),
    lof: Boolean(fund.lof),
    index: fund.index,
    indexName: index.name,
    watchLimit: Boolean(fund.watchLimit),
    watchPremium: Boolean(fund.watchPremium),
    status: status("开放申购", null),
    ...extra,
  };
}

const fees = (management: number, custody: number, service = 0) => ({ management, custody, service, asOf: "", total: management + custody });

function peer(code: string, name: string, extra: Partial<PeerFund> = {}): PeerFund {
  return { code, name, cls: shareClass(name).cls, qdii: false, fees: { management: 0.15, custody: 0.05, service: 0 }, established: "2020-07-16", size: 50e8, status: status("开放申购", null), ...extra };
}

const qdiiPeer = (code: string, name: string, limit: number | null, management = 0.5, custody = 0.15) =>
  peer(code, name, { qdii: true, fees: { management, custody, service: 0 }, status: limit === 0 ? status("暂停申购") : status(limit === null ? "开放申购" : "限大额", limit) });

const premium = (value: number, band: "low" | "mid" | "high") => ({ kind: "qdii" as const, value, band, price: 1, priceDate: "2026-10-30", nav: 1, navDate: "2026-10-29", estimated: false });

const strategy = (extra: Partial<StrategyFile> = {}): StrategyFile => ({
  ...emptyStrategy(),
  checkedAt: NOW.toISOString(),
  peers: {
    黄金9999: [
      peer("008701", "华夏黄金ETF联接A", { size: 86.8e8, status: status("限大额", 75_000_000) }),
      peer("008142", "工银黄金ETF联接A", { size: 64.1e8 }),
    ],
    标准普尔500指数: [qdiiPeer("017641", "摩根标普500指数(QDII)人民币A", 10, 0.5, 0.15), qdiiPeer("050025", "博时标普500ETF联接A", 0, 0.6, 0.2)],
    纳斯达克100指数: [
      qdiiPeer("019172", "摩根纳斯达克100指数(QDII)人民币A", 10, 0.5, 0.1),
      qdiiPeer("016452", "南方纳斯达克100指数发起(QDII)A", 10),
      qdiiPeer("019736", "宝盈纳斯达克100指数发起(QDII)A人民币", 10),
    ],
    ...extra.peers,
  },
  tracked: { ...extra.tracked },
  notices: { ...extra.notices },
});

describe("strategy suggestions", () => {
  const gold = [
    view("008702", { tracking: "黄金9999", fees: fees(0.15, 0.05, 0.35), status: status("限大额", 75_000_000) }),
    view("022502", { tracking: "黄金9999", fees: fees(0.5, 0.1, 0.3), status: status("限大额", 2_000_000) }),
    view("000218", { tracking: "黄金9999", fees: fees(0.5, 0.1) }),
    view("008701", { tracking: "黄金9999", fees: fees(0.15, 0.05), status: status("限大额", 75_000_000) }),
  ];

  it("counts quota as unlimited from 100 万元 a day, and zero when paused", () => {
    expect(capacity(status("限大额", 10))).toBe(10);
    expect(capacity(status("限大额", 75_000_000))).toBe(Infinity);
    expect(capacity(status("暂停申购"))).toBe(0);
    expect(allIn(fees(0.5, 0.1, 0.3))).toBe(0.9);
  });

  it("suggests the cheapest same-metal A class, by group label for A组 and B组", () => {
    const items = buildSuggestions(gold, strategy(), [], NOW);
    expect(items.map((i) => [i.key, i.title])).toEqual([
      ["replace:008702:008701", "华夏黄金ETF联接C（008702）"],
      ["replace:022502:008701", "A组 · 国泰黄金ETF联接E（022502）"],
      ["replace:000218:008701", "B组 · 国泰黄金ETF联接A（000218）"],
    ]);
    expect(items[0].detail).toBe(
      `可以考虑换成华夏黄金ETF联接A（008701），是同一只基金的 A 类份额，每年费用 0.20%，比现在的 0.55%（含销售服务费 0.35%）低 0.35%；日限额 7500 万元，规模 86.8 亿元，成立 6 年。已持有的份额卖出前留意赎回费。${NOTE}`,
    );
    expect(items[1].detail).toContain("同样投资黄金（跟踪上金所 Au99.99），每年费用 0.20%，比现在的 0.90%（含销售服务费 0.30%）低 0.70%");
    expect(items.every((i) => i.kind === "suggestion" && i.action === "replace" && i.detail.endsWith(NOTE))).toBe(true);
  });

  it("needs a meaningful saving, an open fund with at least the same limit, 2 亿 in size; new funds are marked", () => {
    const small = strategy({ peers: { 黄金9999: [peer("008142", "工银黄金ETF联接A", { size: 1.5e8 })] } });
    expect(buildSuggestions([gold[2]], small, [], NOW)).toEqual([]);
    const capped = strategy({ peers: { 黄金9999: [peer("008142", "工银黄金ETF联接A", { status: status("限大额", 10_000) })] } });
    expect(buildSuggestions([gold[2]], capped, [], NOW)).toEqual([]);
    const young = strategy({ peers: { 黄金9999: [peer("026000", "某某黄金ETF联接A", { established: "2026-03-01" })] } });
    expect(buildSuggestions([gold[2]], young, [], NOW)[0].detail).toContain("成立不满一年（2026-03-01 成立），历史较短");
    const close = strategy({ peers: { 黄金9999: [peer("026001", "某某黄金ETF联接A", { fees: { management: 0.45, custody: 0.1, service: 0 } })] } });
    expect(buildSuggestions([gold[2]], close, [], NOW)).toEqual([]);
  });

  it("compares Y shares only with Y shares", () => {
    const pension = view("022930", { tracking: "中证A500指数", fees: fees(0.15, 0.05) });
    const peers = { 中证A500指数: [peer("099001", "某某中证A500ETF联接A", { fees: { management: 0.05, custody: 0.02, service: 0 } }), peer("099002", "某某中证A500ETF联接Y", { fees: { management: 0.05, custody: 0.02, service: 0 } })] };
    expect(buildSuggestions([pension], strategy({ peers }), [], NOW).map((i) => i.key)).toEqual(["replace:022930:099002"]);
  });

  it("waits for a planned overseas fund's quota, and suggests a cheaper open one meanwhile", () => {
    const planned = view("050025", { tracking: "标准普尔500指数", fees: fees(0.6, 0.2), status: status("暂停申购", 100, "不支持") });
    const items = buildSuggestions([planned], strategy(), [], NOW);
    expect(items.map((i) => i.key)).toEqual(["replace:050025:017641"]);
    expect(items[0].detail).toContain("可以考虑改选摩根标普500指数(QDII)人民币A（017641），同样跟踪标普500，每年费用 0.65%，比现在的 0.80% 低 0.15%；日限额 10 元（现在这只暂停申购）");
  });

  it("says to pause the 定投 and switch when a fund stops taking purchases, skipping funds whose quota the 定投 uses", () => {
    const views = [
      view("019172", { tracking: "纳斯达克100指数", fees: fees(0.5, 0.1), status: status("暂停申购", 10, "不支持") }),
      view("016452", { tracking: "纳斯达克100指数", fees: fees(0.5, 0.15), status: status("限大额", 10) }),
    ];
    const stop = buildSuggestions(views, strategy(), [], NOW).find((i) => i.key === "stop:paused:019172")!;
    expect(stop.title).toBe("摩根纳斯达克100指数(QDII)人民币A（019172）暂停申购");
    expect(stop.detail).toMatch(/^可以考虑暂停定投，改投宝盈纳斯达克100指数发起\(QDII\)A人民币（019736），同样跟踪纳斯达克100/);
    expect(stop.target?.code).toBe("019736");
  });

  it("applies the premium rule to on-exchange QDII ETFs both ways", () => {
    const high = view("513500", { tracking: "标准普尔500指数", premium: premium(8.4, "high") });
    const low = view("513100", { tracking: "纳斯达克100指数", premium: premium(1.6, "low") });
    const [stop, add] = buildSuggestions([high, low], strategy(), [], NOW);
    expect(stop).toMatchObject({ key: "stop:premium:513500", action: "stop", title: "场内 博时标普500ETF（513500） 溢价 8.40%" });
    expect(stop.detail).toContain("高于规则三的 2%–3%（按 10月29日净值）。可以考虑暂缓场内买入，改用场外的摩根标普500指数(QDII)人民币A（017641）");
    expect(add).toMatchObject({ key: "increase:premium:513100", action: "increase" });
    expect(add.detail).toBe(`在规则三的 2% 以内（按 10月29日净值）。可以考虑在场内买入。${NOTE}`);
  });

  it("cues more overseas when quota reopens, on a tracked fund or a peer with several times the limit", () => {
    const views = [
      view("019172", { tracking: "纳斯达克100指数", fees: fees(0.5, 0.1), status: status("限大额", 10) }),
      view("016452", { tracking: "纳斯达克100指数", fees: fees(0.5, 0.15), status: status("限大额", 10) }),
    ];
    const opened = strategy({ peers: { 纳斯达克100指数: [qdiiPeer("019736", "宝盈纳斯达克100指数发起(QDII)A人民币", 1000)] } });
    const reopen: AlertEvent = { id: "limit-up:016452:t", kind: "limit-up", code: "016452", at: NOW.toISOString(), from: "暂停申购", to: "限大额 · 10 元/日", severity: "good" };
    const items = buildSuggestions(views, opened, [reopen], NOW);
    expect(items.map((i) => [i.key, i.title])).toEqual([
      ["increase:reopen:limit-up:016452:t", "南方纳斯达克100指数发起(QDII)A（016452）恢复申购"],
      ["increase:quota:ndx:019736:1000", "纳斯达克100：宝盈纳斯达克100指数发起(QDII)A人民币（019736）日限额 1000 元"],
    ]);
    expect(items[1].detail).toBe(`019172、016452 日限额 10 元；宝盈纳斯达克100指数发起(QDII)A人民币同样跟踪纳斯达克100，每年费用 0.65%，规模 50.0 亿元，成立 6 年。海外部分可以考虑通过它加大投入。${NOTE}`);
    const modest = strategy({ peers: { 纳斯达克100指数: [qdiiPeer("019736", "宝盈纳斯达克100指数发起(QDII)A人民币", 40)] } });
    expect(buildSuggestions(views, modest, [], NOW)).toEqual([]);
  });

  it("raises stop signals: fee raised above the rule, tiny size, material notices, tracking error", () => {
    const raised = view("110020", { tracking: "沪深300指数", fees: fees(0.5, 0.1), feeRule: { kind: "domestic", cap: 0.2, total: 0.6, ok: false } });
    const event: AlertEvent = { id: "fee-change:110020:t", kind: "fee-change", code: "110020", at: NOW.toISOString(), from: "管理费 0.15%", to: "管理费 0.5%", severity: "warn" };
    const others = [view("501060", { tracking: "中证中金优选300指数" }), view("007466", { tracking: "中证红利低波动指数" }), view("019172", { tracking: "纳斯达克100指数", status: status("限大额", 10) })];
    const file = strategy({
      peers: { 沪深300指数: [peer("000051", "华夏沪深300ETF联接A")] },
      tracked: { "501060": { size: 3.2e7, sizeDate: "2026-09-30" }, "019172": { trackingError: 5.1 } },
      notices: { "007466": [{ id: "AN1", title: "关于华泰柏瑞中证红利低波动ETF联接基金变更业绩比较基准的公告", date: "2026-10-20" }] },
    });
    const items = buildSuggestions([raised, ...others], file, [event], NOW);
    expect(items.map((i) => [i.key, i.action])).toEqual([
      ["stop:fee:fee-change:110020:t", "stop"],
      ["stop:size:501060", "stop"],
      ["stop:notice:007466:AN1", "stop"],
      ["stop:te:019172", "stop"],
    ]);
    expect(items[0].detail).toContain("超过规则四的约 0.2%。可以考虑改选华夏沪深300ETF联接A（000051）");
    expect(items[1].detail).toContain("规模 3200 万元（截至 2026-09-30），低于 5000 万元，有清盘的可能。");
    expect(items[1].title).toBe("A组 · 中金中证优选300指数(LOF)A（501060）规模过小");
    expect(items[3].detail).toContain("近一年年化跟踪误差 5.10%，这类基金通常在 4% 以内");
  });

  it("names A组 and B组 funds by their group label only", () => {
    const items = buildSuggestions(gold, strategy(), [], NOW).filter((i) => i.code === "022502" || i.code === "000218");
    expect(items.map((i) => i.title.split(" · ")[0])).toEqual(["A组", "B组"]);
    for (const i of items) expect(i.detail).not.toMatch(/group|组/);
  });
});
