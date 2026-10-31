import { describe, expect, it } from "vitest";
import { FUNDS, INDICES, MACRO } from "@/config/invest";
import { AVAILABILITY } from "@/config/market-calendar";
import { checkHealth, expectedDate, type RunFreshness } from "@/lib/invest/health";
import { diffNotifications, formatMessage, type NotifyFile } from "@/lib/invest/notify";
import { buildObservations, type Observation } from "@/lib/invest/observations";
import { buildStatus, runNotifications, type NotifyOptions } from "@/lib/invest/status";
import { NOTE } from "@/lib/invest/suggestions";
import type { AlertEvent, CalendarFile, Close, DataIssue, FundsFile, FundView, InvestNewsItem, MarketFile, NewsFile } from "@/lib/invest/types";

// Friday 20:00 in Beijing, 08:00 in New York.
const NOW = new Date("2026-10-30T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

describe("expected trading day", () => {
  it("skips weekends and waits for each market's close", () => {
    const saturday = new Date("2026-10-31T05:43:00Z");
    expect(expectedDate(AVAILABILITY.cnClose, saturday)).toBe("2026-10-30");
    expect(expectedDate(AVAILABILITY.usClose, saturday)).toBe("2026-10-30");
    expect(expectedDate(AVAILABILITY.cnClose, NOW)).toBe("2026-10-30");
    expect(expectedDate(AVAILABILITY.usClose, NOW)).toBe("2026-10-29");
    expect(expectedDate(AVAILABILITY.navDomestic, NOW)).toBe("2026-10-29");
  });

  it("skips listed holidays in China and the US", () => {
    expect(expectedDate(AVAILABILITY.cnClose, new Date("2026-10-08T00:00:00Z"))).toBe("2026-09-30");
    expect(expectedDate(AVAILABILITY.cnClose, new Date("2026-10-08T08:00:00Z"))).toBe("2026-10-08");
    expect(expectedDate(AVAILABILITY.usClose, new Date("2026-11-27T12:00:00Z"))).toBe("2026-11-25");
  });

  it("allows for publication lags: QDII NAVs two trading days, Treasury yields one", () => {
    expect(expectedDate(AVAILABILITY.navQdii, NOW)).toBe("2026-10-27");
    expect(expectedDate(AVAILABILITY.treasury, new Date("2026-11-02T00:00:00Z"))).toBe("2026-10-29");
  });
});

const DAY: Record<string, string> = {
  ndx: "2026-10-29",
  spx: "2026-10-29",
  spxew: "2026-10-29",
  xau: "2026-10-29",
  dxy: "2026-10-29",
  us10y: "2026-10-29",
  usdcnh: "2026-10-29",
  real10y: "2026-10-28",
};

const closes = (day: string, last = 101, prev = 100): Close[] => [
  ["2026-10-20", prev],
  [day, last],
];

function currentData() {
  const market: MarketFile = { updatedAt: hoursAgo(1), series: {}, valuations: {} };
  for (const id of [...INDICES.map((i) => i.id), ...MACRO.map((m) => m.id)]) {
    market.series[id] = { name: id, closes: id === "cnbond" || id === "us10y" || id === "real10y" ? closes(DAY[id] ?? "2026-10-30", 1.65, 1.63) : closes(DAY[id] ?? "2026-10-30"), source: "test", fetchedAt: hoursAgo(1) };
  }
  for (const index of INDICES) if (index.valuation) market.valuations[index.id] = { pe: 20, date: "2026-10-29", source: "test" };
  const funds: FundsFile = { updatedAt: hoursAgo(1), funds: {} };
  for (const f of FUNDS) {
    const qdii = INDICES.find((i) => i.id === f.index)?.market === "us";
    funds.funds[f.code] = {
      code: f.code,
      updatedAt: hoursAgo(1),
      navs: [{ date: qdii ? "2026-10-28" : "2026-10-29", nav: 1.2, changePct: 0.3 }],
      status: { purchase: "开放申购", asOf: hoursAgo(1) },
      fees: { management: 0.15, custody: 0.05, asOf: hoursAgo(1) },
      ...(f.etf || f.lof ? { prices: closes("2026-10-30", 1.01, 1) } : {}),
    };
  }
  const news: NewsFile = { updatedAt: hoursAgo(1), items: [{ publishedAt: hoursAgo(2) } as InvestNewsItem] };
  const calendar: CalendarFile = { updatedAt: hoursAgo(1), events: [], fomc: [] };
  return { market, funds, news, calendar };
}

function allFresh(): RunFreshness {
  return {
    series: new Set([...INDICES.map((i) => i.id), ...MACRO.map((m) => m.id)]),
    prices: new Set(FUNDS.filter((f) => f.etf || f.lof).map((f) => f.code)),
    navs: new Set(FUNDS.map((f) => f.code)),
    feePages: new Set(FUNDS.map((f) => f.code)),
    valuations: new Set(INDICES.filter((i) => i.valuation).map((i) => i.id)),
    implausible: new Map(),
    sources: [
      { id: "cls", name: "财联社", kind: "新闻", ok: true, count: 10, ms: 1 },
      { id: "ft-markets", name: "FT", kind: "新闻", ok: true, count: 10, ms: 1 },
      { id: "wscn-calendar", name: "华尔街见闻财经日历", kind: "日历", ok: true, count: 5, ms: 1 },
    ],
  };
}

describe("data health", () => {
  it("finds nothing wrong when every figure is from the latest trading day", () => {
    const health = checkHealth(currentData(), allFresh(), null, NOW);
    expect(health.issues).toEqual([]);
    expect(Object.values(health.groups).every((g) => g.ok && g.lastSuccess === NOW.toISOString())).toBe(true);
  });

  it("flags a figure that stopped while the rest of its market moved on", () => {
    const data = currentData();
    data.market.series.spx!.closes = closes("2026-10-28");
    const health = checkHealth(data, allFresh(), { groups: { indices: { lastSuccess: hoursAgo(24) } } }, NOW);
    expect(health.issues).toEqual([expect.objectContaining({ key: "stale:indices", severity: "warn", message: "指数行情没有更新到最新交易日：标普500（停在 10月28日）" })]);
    expect(health.groups.indices).toMatchObject({ ok: false, lastSuccess: hoursAgo(24) });
    expect(health.groups.indices.items.find((i) => i.key === "spx")).toMatchObject({ stale: true, expected: "2026-10-29" });
  });

  it("takes a closure missing from the holiday list when the market's figures agree, but not a lone series", () => {
    const data = currentData();
    for (const id of ["ndx", "spx", "spxew"] as const) data.market.series[id]!.closes = closes("2026-10-28");
    data.market.series.real10y!.closes = closes("2026-10-27", 1.65, 1.63);
    const health = checkHealth(data, allFresh(), null, NOW);
    expect(health.issues.map((i) => i.key)).toEqual(["stale:macro"]);
    expect(health.issues[0].items).toEqual(["美债10年期实际利率"]);
  });

  it("lists figures that got no fresh data but are still current as a minor issue", () => {
    const fresh = allFresh();
    fresh.series.delete("shau");
    fresh.navs.delete("019172");
    const health = checkHealth(currentData(), fresh, null, NOW);
    expect(health.issues.map((i) => [i.key, i.severity])).toEqual([
      ["failed:gold", "minor"],
      ["failed:nav", "minor"],
    ]);
    expect(health.groups.gold.ok).toBe(true);
    expect(health.groups.gold.lastSuccess).toBeUndefined();
  });

  it("reports rejected data and implausible moves", () => {
    const data = currentData();
    data.market.series.csi300!.closes = closes("2026-10-30", 115, 100);
    data.market.series.us10y!.closes = closes("2026-10-29", 4.9, 4.1);
    const fresh = allFresh();
    fresh.series.delete("ndx");
    fresh.implausible.set("ndx", "行情来源返回的数据单日变动 96%");
    const health = checkHealth(data, fresh, null, NOW);
    expect(health.issues.map((i) => i.message)).toEqual([
      "纳斯达克100：行情来源返回的数据单日变动 96%，未采用，页面显示上次的数据",
      "沪深300 单日变动 +15.0%，超出常见范围，请核对是否为数据错误",
      "美债10年期收益率 单日变动 +80bp，超出常见范围，请核对是否为数据错误",
    ]);
  });

  it("flags fund status pages unread for a day and a half, and old news", () => {
    const data = currentData();
    data.funds.funds["096001"].status!.asOf = hoursAgo(40);
    data.funds.funds["096001"].fees!.asOf = hoursAgo(40);
    data.news.items = [{ publishedAt: hoursAgo(30) } as InvestNewsItem];
    const fresh = allFresh();
    fresh.feePages.delete("096001");
    fresh.feePages.delete("019172");
    const health = checkHealth(data, fresh, null, NOW);
    expect(health.issues.map((i) => [i.key, i.severity, i.items.join()])).toEqual([
      ["stale:fundInfo", "warn", "096001 申购状态与费率"],
      ["stale:news", "warn", "新闻"],
      ["failed:fundInfo", "minor", "019172 申购状态与费率"],
    ]);
  });
});

const view = (code: string, extra: Partial<FundView> = {}): FundView => ({
  code,
  name: FUNDS.find((f) => f.code === code)?.name ?? code,
  group: FUNDS.find((f) => f.code === code)?.group ?? "later",
  etf: false,
  lof: false,
  index: FUNDS.find((f) => f.code === code)?.index ?? "csi300",
  indexName: "",
  watchLimit: true,
  watchPremium: false,
  ...extra,
});

const premium = (kind: "qdii" | "domestic", value: number, band: "low" | "mid" | "high" | "normal" | "unusual") => ({
  kind,
  value,
  band,
  price: 1,
  priceDate: "2026-10-30",
  nav: 1,
  navDate: "2026-10-29",
  estimated: kind === "qdii",
});

describe("rule observations", () => {
  const views = [
    view("008702", { fees: { management: 0.15, custody: 0.05, service: 0.35, asOf: "" } }),
    view("022502"),
    view("019172", { fees: { management: 0.8, custody: 0.15, service: 0, asOf: "" }, feeRule: { kind: "qdii", cap: 1, total: 0.95, ok: true } }),
    view("096001", { feeRule: { kind: "qdii", cap: 1, total: 1.2, ok: false } }),
    view("999999", { name: "某某中证500指数增强A" }),
    view("513500", { etf: true, premium: premium("qdii", 8.41, "high") }),
    view("513100", { etf: true, premium: premium("qdii", 1.6, "low") }),
    view("510300", { etf: true, premium: premium("domestic", -1.3, "unusual") }),
    view("512890", { etf: true, premium: premium("domestic", 0.2, "normal") }),
  ];

  it("applies rules 1–4 to every fund it fits", () => {
    const obs = buildObservations([], views, NOW);
    expect(obs.map((o) => [o.key, o.severity])).toEqual([
      ["rule1:008702", "warn"],
      ["rule1:022502", "warn"],
      ["rule4:096001", "warn"],
      ["rule2:999999", "warn"],
      ["rule3:513500:above", "bad"],
      ["rule3:513100:within", "good"],
      ["rule3:510300:unusual", "warn"],
    ]);
    expect(obs.find((o) => o.key === "rule3:513500:above")?.detail).toBe("高于规则三的 2%–3%（按 10月29日净值和此后的指数涨跌估算）。");
  });

  it("states facts without buy or sell advice", () => {
    const events: AlertEvent[] = [
      { id: "limit-down:019172:x", kind: "limit-down", code: "019172", at: hoursAgo(3), from: "限大额 · 50 元/日", to: "暂停申购", severity: "bad" },
      { id: "limit-up:050025:x", kind: "limit-up", code: "050025", at: hoursAgo(3), from: "暂停申购", to: "开放申购", severity: "good" },
    ];
    const text = buildObservations(events, views, NOW)
      .map((o) => o.title + o.detail)
      .join("\n");
    expect(text).not.toMatch(/不买|别买|买入|卖出|建议|该买|该卖/);
    expect(text).toContain("按原金额定投可能扣款失败");
  });

  it("leaves premium changes to rule 3, keeps limit changes for a week and reminds on the first days of a month", () => {
    const events: AlertEvent[] = [
      { id: "premium-low:513100:x", kind: "premium-low", code: "513100", at: hoursAgo(3), from: "2%–3%", to: "1.6%", severity: "good" },
      { id: "fee-change:019172:x", kind: "fee-change", code: "019172", at: hoursAgo(24 * 8), from: "管理费 0.8%", to: "管理费 0.6%", severity: "good" },
    ];
    expect(buildObservations(events, [], NOW)).toEqual([]);
    const monthStart = new Date("2026-11-02T01:00:00Z");
    expect(buildObservations([], [], monthStart)).toEqual([expect.objectContaining({ key: "monthly:2026-11", kind: "reminder", title: "11月定投扣款核对" })]);
  });
});

const issue = (key: string, items: string[], severity: DataIssue["severity"] = "warn"): DataIssue => ({
  key,
  group: "indices",
  kind: "stale",
  severity,
  message: `指数行情没有更新到最新交易日：${items.join("、")}`,
  items,
});

describe("notifications", () => {
  const ruleMismatch = buildObservations([], [view("096001", { feeRule: { kind: "qdii", cap: 1, total: 1.2, ok: false } })], NOW);
  const replace: Observation = {
    key: "replace:007466:020602",
    kind: "suggestion",
    action: "replace",
    severity: "warn",
    code: "007466",
    title: "华泰柏瑞中证红利低波ETF联接A（007466）",
    detail: `可以考虑改选易方达中证红利低波动ETF联接发起式A（020602），每年费用低 0.40%。${NOTE}`,
  };
  const alerts = [...ruleMismatch, replace];

  it("pushes strategy suggestions, data problems and reminders, but not standing rule mismatches", () => {
    const first = diffNotifications({}, [issue("stale:indices", ["标普500"]), issue("failed:source:ft", ["FT"], "minor")], alerts);
    expect(first.issues.map((i) => i.key)).toEqual(["stale:indices"]);
    expect(first.suggestions.map((s) => s.key)).toEqual(["replace:007466:020602"]);
    expect(Object.keys(first.next)).not.toContain("alert:rule4:096001");
    expect(diffNotifications(first.next, [issue("stale:indices", ["标普500"])], alerts)).toMatchObject({ issues: [], suggestions: [], reminders: [], resolved: [] });
    const changed = diffNotifications(first.next, [issue("stale:indices", ["标普500", "纳斯达克100"])], alerts);
    expect(changed.issues).toHaveLength(1);
    const gone = diffNotifications(first.next, [], alerts);
    expect(gone.resolved).toEqual(["指数行情没有更新到最新交易日"]);
    expect(formatMessage(gone, "https://x/invest/")?.title).toBe("投资日报：数据已恢复");
    const reminder = buildObservations([], [], new Date("2026-12-24T01:00:00Z"));
    expect(diffNotifications(first.next, [issue("stale:indices", ["标普500"])], [...alerts, ...reminder]).reminders.map((r) => r.key)).toEqual(["pension:2026:final"]);
  });

  it("groups one message by action, each suggestion ending with the disclaimer", () => {
    const stop: Observation = { ...replace, key: "stop:premium:513500", action: "stop", title: "场内 标普500ETF博时（513500） 溢价 8.40%", detail: `可以考虑暂缓场内买入。${NOTE}` };
    const message = formatMessage(diffNotifications({}, [issue("stale:indices", ["标普500"])], [...alerts, stop]), "https://yjpdccn.github.io/CSOnline/invest/")!;
    expect(message.title).toBe("投资日报：2 条策略建议，1 项数据异常");
    expect(message.title.length).toBeLessThanOrEqual(32);
    const order = ["推送改为策略建议", "**可以考虑替换**", "**可以考虑停止**", "**数据异常**"].map((h) => message.markdown.indexOf(h));
    expect(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1]))).toBe(true);
    expect(message.markdown).not.toContain("096001");
    expect(message.markdown.split("\n").filter((l) => l.startsWith("- ") && !l.includes("指数行情")).every((l) => l.endsWith(NOTE))).toBe(true);
    expect(message.markdown).toContain("[status.json](https://yjpdccn.github.io/CSOnline/invest/status.json)");
    expect(formatMessage(diffNotifications({}, [], ruleMismatch), "https://x/")).toBeNull();
  });

  function fakeFetch(handler: (url: string, init: RequestInit) => unknown) {
    const calls: { url: string; method: string; body?: string }[] = [];
    const impl = (async (input: string | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, method: init.method ?? "GET", body: typeof init.body === "string" ? init.body : undefined });
      const result = handler(url, init);
      if (result instanceof Response) return result;
      return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    return { impl, calls };
  }

  const github = (url: string, init: RequestInit) => {
    if (url.endsWith("/issues?state=open&per_page=100")) return [];
    if (url.endsWith("/repos/o/r/issues") && init.method === "POST") return { number: 7, title: "投资日报提醒", html_url: "https://github.com/o/r/issues/7", state: "open" };
    if (url.endsWith("/repos/o/r/issues/7")) return { number: 7, title: "投资日报提醒", html_url: "https://github.com/o/r/issues/7", state: "open" };
    if (url.endsWith("/issues/7/comments")) return { id: 1 };
    return new Response("not found", { status: 404 });
  };
  const options = (fetchImpl: typeof fetch, extra: Partial<NotifyOptions> = {}): NotifyOptions => ({ enabled: true, repo: "o/r", token: "t", owner: "o", fetchImpl, ...extra });

  it("uses one rolling GitHub issue without any setup, mentioning the owner, one email per message", async () => {
    const { impl, calls } = fakeFetch(github);
    const route = () => calls.map((c) => `${c.method} ${c.url.replace("https://api.github.com", "")}`);
    const first = await runNotifications({ sent: {} }, [], alerts, options(impl), NOW);
    expect(first.outcome).toMatchObject({ result: "sent", channel: "github-issue" });
    expect(first.state).toMatchObject({ issueNumber: 7, lastSentAt: NOW.toISOString() });
    expect(first.summary).toMatchObject({ channel: "github-issue", issueUrl: "https://github.com/o/r/issues/7" });
    expect(route()).toEqual(["GET /repos/o/r/issues?state=open&per_page=100", "POST /repos/o/r/issues"]);
    const opened = JSON.parse(calls[1].body!);
    expect(opened.body).toMatch(/^@o /);
    expect(opened.body).toContain("007466");

    calls.length = 0;
    const again = await runNotifications(first.state, [], alerts, options(impl), NOW);
    expect(again.outcome.result).toBe("nothing-new");
    expect(calls).toEqual([]);

    const later = await runNotifications(first.state, [issue("stale:gold", ["上海金"])], alerts, options(impl), NOW);
    expect(later.outcome.result).toBe("sent");
    expect(route()).toEqual(["GET /repos/o/r/issues/7", "POST /repos/o/r/issues/7/comments"]);
    const comment = JSON.parse(calls[1].body!).body;
    expect(comment).toContain("上海金");
    expect(comment).toMatch(/@o$/);
  });

  it("pushes to WeChat through Server酱 when its SendKey is set, for both key formats", async () => {
    const turbo = fakeFetch(() => ({ code: 0, data: { errno: 0 } }));
    const sent = await runNotifications({ sent: {} }, [], alerts, options(turbo.impl, { serverChanKey: "SCT123abc" }), NOW);
    expect(sent.outcome).toMatchObject({ result: "sent", channel: "serverchan" });
    expect(turbo.calls[0].url).toBe("https://sctapi.ftqq.com/SCT123abc.send");
    expect(new URLSearchParams(turbo.calls[0].body).get("title")).toBe("投资日报：1 条策略建议");

    const v3 = fakeFetch(() => ({ code: 0 }));
    await runNotifications({ sent: {} }, [], alerts, options(v3.impl, { serverChanKey: "sctp4567tXYZ" }), NOW);
    expect(v3.calls[0].url).toBe("https://4567.push.ft07.com/send/sctp4567tXYZ.send");
    expect(JSON.parse(v3.calls[0].body!)).toMatchObject({ title: "投资日报：1 条策略建议" });
  });

  it("falls back to the issue when WeChat fails, and retries next run when everything fails", async () => {
    const flaky = fakeFetch((url, init) => (url.includes("ftqq.com") ? { code: 40001, message: "bad pushtoken" } : github(url, init)));
    const fallback = await runNotifications({ sent: {} }, [], alerts, options(flaky.impl, { serverChanKey: "SCTbad" }), NOW);
    expect(fallback.outcome).toMatchObject({ result: "sent", channel: "github-issue" });
    expect(fallback.state.lastError).toContain("bad pushtoken");

    const down = fakeFetch(() => new Response("oops", { status: 502 }));
    const state: NotifyFile = { sent: {} };
    const failed = await runNotifications(state, [], alerts, options(down.impl), NOW);
    expect(failed.outcome.result).toBe("failed");
    expect(failed.state.sent).toEqual({});
    expect(failed.state.lastError).toContain("502");
  });

  it("never sends from a local run", async () => {
    const { impl, calls } = fakeFetch(github);
    const local = await runNotifications({ sent: {} }, [issue("stale:indices", ["标普500"])], alerts, options(impl, { enabled: false }), NOW);
    expect(local.outcome.result).toBe("skipped");
    expect(local.state).toEqual({ sent: {} });
    expect(calls).toEqual([]);
  });
});

describe("status.json", () => {
  it("keeps firstSeen while an issue or alert lasts", () => {
    const health = checkHealth(currentData(), allFresh(), null, NOW);
    const alerts = buildObservations([], [view("096001", { feeRule: { kind: "qdii", cap: 1, total: 1.2, ok: false } })], NOW);
    const notifications = { channel: "github-issue" as const, lastSentAt: null, issueUrl: null };
    const first = buildStatus({ ...health, issues: [issue("stale:indices", ["标普500"])] }, alerts, null, notifications, NOW);
    expect(first).toMatchObject({ version: 1, ok: false, since: NOW.toISOString() });
    expect(first.alerts[0]).toMatchObject({ key: "rule4:096001", firstSeen: NOW.toISOString() });

    const later = new Date(NOW.getTime() + 12 * 3600_000);
    const second = buildStatus({ ...health, issues: [issue("stale:indices", ["标普500"]), issue("stale:gold", ["上海金"])] }, alerts, first, notifications, later);
    expect(second.since).toBe(NOW.toISOString());
    expect(second.dataIssues.map((i) => [i.key, i.firstSeen])).toEqual([
      ["stale:indices", NOW.toISOString()],
      ["stale:gold", later.toISOString()],
    ]);
    expect(second.alerts[0].firstSeen).toBe(NOW.toISOString());
  });
});
