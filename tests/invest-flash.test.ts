import { describe, expect, it } from "vitest";
import { INVEST_SOURCES } from "@/config/invest-news";
import { detectEvents, eventObservations, nextBand } from "@/lib/invest/events";
import { compareFlashes } from "@/lib/invest/flash";
import { mergeNews, rankNews, toInvestItem } from "@/lib/invest/news";
import { diffNotifications, formatMessage } from "@/lib/invest/notify";
import type { Observation } from "@/lib/invest/observations";
import { loadLatestOutlook } from "@/lib/invest/outlook";
import { buildStrip, type PageAlert } from "@/lib/invest/page-data";
import type { InvestNewsItem, MarketFile } from "@/lib/invest/types";

const NOW = new Date("2026-11-02T02:35:00Z");
const source = (id: string) => INVEST_SOURCES.find((s) => s.id === id)!;
let n = 0;
function flash(sourceId: string, title: string, minutesAgo: number, extra: Partial<InvestNewsItem> = {}): InvestNewsItem {
  const item = toInvestItem({ title, url: `https://example.com/${n++}`, publishedAt: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString() }, source(sourceId), NOW);
  if (!item) throw new Error(`filtered: ${title}`);
  return { ...item, ...extra };
}
const cards = (items: InvestNewsItem[]) => mergeNews([], items, NOW).items.filter((i) => !i.dupOf);
const gap = (a: InvestNewsItem, b: InvestNewsItem) => Math.abs(Date.parse(a.publishedAt) - Date.parse(b.publishedAt));

describe("finance flash dedup", () => {
  it("folds one session report, one open-market operation and one data release into one card each", () => {
    expect(cards([flash("wscn-global", "上证指数开盘报3614.31点，涨0.42%", 70), flash("cls", "创业板指高开1.05%", 70), flash("em-focus", "A股开盘：三大指数集体高开", 69)])).toHaveLength(1);
    expect(cards([flash("sina", "中国央行逆回购今日净回笼5150亿元人民币", 73), flash("em-pboc", "央行今日开展5410亿元隔夜逆回购操作", 72)])).toHaveLength(1);
    expect(
      cards([flash("wscn-global", "中国10月官方制造业PMI 49.3，前值 50.1", 60), flash("cls", "国家统计局：10月份制造业采购经理指数（PMI）为49.3%", 59), flash("wscn-global", "中国10月RatingDog制造业PMI 52，前值 52.1", 30)]),
    ).toHaveLength(2);
  });

  it("joins a meeting announced twice and one official's speech, also across languages", () => {
    expect(cards([flash("em-focus", "央行、证监会将于周一召开座谈会 研究推动支持资本市场工具使用", 120), flash("cls", "央行将召开股票回购增持再贷款座谈会", 90)])).toHaveLength(1);
    const speech = [
      flash("sina", "美联储官员穆萨莱姆：美联储将需要“很快”再次加息", 50),
      flash("sina", "美联储理事穆萨莱姆：通胀风险仍偏向上行", 50),
      flash("wscn-global", "美联储穆萨勒姆：需尽快进一步加息以抑制通胀", 51),
      flash("cnbc-economy", "St. Louis Fed's Musalem: Another rate hike needed 'soon'", 30),
    ];
    expect(cards(speech)).toHaveLength(1);
  });

  it("keeps apart different officials, instruments and central banks, and previews of a decision", () => {
    const musalem = flash("sina", "美联储理事穆萨莱姆：需要进一步取消宽松政策，以确保通胀率在18个月内回落至2%", 120);
    const logan = flash("sina", "美联储洛根：通胀未能回落至美联储2%的目标是“不可接受的”", 60);
    expect(compareFlashes(musalem, logan, gap(musalem, logan))).toMatchObject({ same: false });
    const nasdaq = flash("wscn-global", "纳指期货跌幅扩大至2.5%", 200);
    const bonds = flash("wscn-global", "中国30年期国债期货跌幅扩大至0.76%", 180);
    expect(compareFlashes(nasdaq, bonds, gap(nasdaq, bonds))).toEqual({ same: false, reason: "不同的标的" });
    const boj = flash("em-commodity", "日本央行维持利率不变并加快缩表 政策目标开始转向？", 300);
    const ecb = flash("sina", "马赫卢夫：维持利率不变并不表明欧洲央行已完成加息", 240);
    expect(cards([boj, ecb])).toHaveLength(2);
    expect(cards([flash("em-cb", "日本央行10月利率决议看点前瞻", 300), flash("cls", "日本央行将政策利率维持在1.25%不变，符合市场预期", 240)])).toHaveLength(2);
  });

  it("ranks routine session reports below news of the same coverage", () => {
    const routine = [flash("wscn-global", "上证指数开盘报3614.31点，涨0.42%", 70), flash("cls", "创业板指高开1.05%", 70)];
    const news = [flash("wscn-global", "证监会：全力稳市场稳预期 持续提升资本市场韧性和信心", 70), flash("cls", "证监会：全力稳市场稳预期 持续提升资本市场韧性和信心", 70)];
    const ranked = rankNews(mergeNews([], [...routine, ...news], NOW).items, NOW);
    expect(ranked[0].item.title).toContain("证监会");
  });
});

const market = (closes: Record<string, [string, number][]>, valuations: MarketFile["valuations"] = {}): MarketFile => ({
  updatedAt: "",
  series: Object.fromEntries(Object.entries(closes).map(([id, c]) => [id, { name: id, closes: c, source: "t", fetchedAt: "" }])),
  valuations,
});

describe("major events", () => {
  it("flags one-day moves of 3% or more and valuation bands crossed, with hysteresis", () => {
    const m = market(
      { ndx: [["2026-10-29", 29402.51], ["2026-10-30", 28384.85]], spx: [["2026-10-29", 7720.39], ["2026-10-30", 7580.07]], xau: [["2026-10-29", 4021.39], ["2026-10-30", 3875.55]] },
      { ndx: { pe: 27.4, pePercentile: 0.19, date: "2026-10-30", since: "2016-07-14", source: "蛋卷基金" } },
    );
    const first = detectEvents({ market: m, ranked: [], previous: null, now: NOW });
    expect(first.events.map((e) => e.title)).toEqual(["纳斯达克100 10月30日下跌 3.5%", "现货黄金 10月30日下跌 3.6%"]);
    expect(first.bands.ndx).toBe("low");
    expect(eventObservations(first, NOW).map((o) => [o.kind, o.key])).toEqual([
      ["event", "move:ndx:2026-10-30"],
      ["event", "move:xau:2026-10-30"],
    ]);
    expect(eventObservations(first, new Date("2026-11-04T02:00:00Z"))).toEqual([]);
    const before = { ...first, bands: { ndx: "mid" as const } };
    const crossed = detectEvents({ market: m, ranked: [], previous: before, now: NOW });
    expect(crossed.events.find((e) => e.kind === "valuation")?.title).toBe("纳斯达克100估值进入低估区（低于 20%）");
    expect(nextBand("low", 23)).toBe("low");
    expect(nextBand("low", 26)).toBe("mid");
    expect(nextBand("high", 76)).toBe("high");
  });

  it("finds rate decisions and widely covered policy news, not previews", () => {
    const items = [
      flash("cls", "日本央行将政策利率维持在1.25%不变，符合市场预期", 300),
      flash("wscn-global", "美联储12月利率决议前瞻：或将加息25个基点", 200),
      flash("em-focus", "央行、证监会将于周一召开座谈会 研究推动支持资本市场工具使用", 600),
      flash("cls", "央行、证监会将于明天召开座谈会 研究推动支持资本市场工具使用", 590),
      flash("wscn-global", "央行、证监会将于明天召开座谈会 研究推动支持资本市场工具使用", 588),
      flash("em-pboc", "央行将召开股票回购增持再贷款座谈会", 560),
    ];
    const ranked = rankNews(mergeNews([], items, NOW).items, NOW);
    const events = detectEvents({ market: market({}), ranked, previous: null, now: NOW }).events;
    expect(events.map((e) => [e.kind, e.title])).toEqual([
      ["rate", "日本央行将政策利率维持在1.25%不变，符合市场预期"],
      ["policy", "央行、证监会将于周一召开座谈会 研究推动支持资本市场工具使用"],
    ]);
  });
});

describe("pushes and the alert strip", () => {
  const minor: Observation = { key: "replace:050025:017641", kind: "suggestion", action: "replace", severity: "warn", saving: 0.15, title: "博时标普500ETF联接A（050025）", detail: "…" };
  const material: Observation = { ...minor, key: "replace:007466:020602", saving: 0.4, title: "华泰柏瑞中证红利低波ETF联接A（007466）" };
  const fresh: Observation = { key: "move:ndx:2026-11-01", kind: "event", severity: "warn", title: "纳斯达克100 11月1日下跌 3.5%", detail: "…", at: "2026-11-01T15:59:00Z" };
  const old: Observation = { ...fresh, key: "move:xau:2026-10-30", title: "现货黄金 10月30日下跌 3.6%", at: "2026-10-30T15:59:00Z" };

  it("pushes material fee savings one by one and the small ones as one line a month", () => {
    const diff = diffNotifications({}, [], [minor, material], NOW);
    expect(diff.suggestions.map((s) => s.key)).toEqual(["replace:007466:020602"]);
    expect(diff.minorFees).toBe(1);
    expect(formatMessage(diff, "https://x/invest/")!.markdown).toContain("另有 1 条每年省费不到 0.3% 的替换建议");
    const later = diffNotifications(diff.next, [], [minor, material, { ...minor, key: "replace:000218:008142", saving: 0.2 }], NOW);
    expect(later.minorFees).toBeUndefined();
    expect(formatMessage(later, "https://x/")).toBeNull();
    expect(diffNotifications(later.next, [], [minor, { ...minor, key: "replace:000218:008142", saving: 0.2 }], new Date("2026-12-01T02:00:00Z")).minorFees).toBe(1);
  });

  it("puts fresh major events first and leaves stale ones on the page", () => {
    const diff = diffNotifications({}, [], [old, fresh, material], NOW);
    expect(diff.events.map((e) => e.key)).toEqual(["move:ndx:2026-11-01"]);
    expect(Object.keys(diff.next)).toContain("alert:move:xau:2026-10-30");
    const message = formatMessage(diff, "https://x/invest/")!;
    expect(message.title).toBe("投资日报：1 项重大事件，1 条策略建议");
    expect(message.markdown.indexOf("**重大事件**")).toBeLessThan(message.markdown.indexOf("**可以考虑替换**"));
  });

  it("keeps the strip to what matters now", () => {
    const observations: PageAlert[] = [
      fresh,
      { key: "limit-down:019172:t", kind: "change", severity: "bad", code: "019172", title: "019172 申购额度收紧", detail: "限大额 · 10 元/日 → 暂停申购", at: "2026-11-01T10:00:00Z" },
      { key: "limit-down:022459:t", kind: "change", severity: "bad", code: "022459", title: "022459 申购额度收紧", detail: "…", at: "2026-11-01T10:00:00Z" },
      { key: "stop:paused:022502", kind: "suggestion", action: "stop", severity: "bad", code: "022502", title: "A组 · 022502 暂停申购", detail: "…" },
      { key: "stop:premium:513500", kind: "suggestion", action: "stop", severity: "bad", code: "513500", title: "场内 513500 溢价 8.40%", detail: "…" },
      material,
      { key: "rule4:096001", kind: "rule", rule: 4, severity: "warn", code: "096001", title: "费率", detail: "…" },
    ];
    const health = { checkedAt: NOW.toISOString(), since: NOW.toISOString(), notifications: { channel: "serverchan" as const, lastSentAt: null, issueUrl: null }, issues: [{ key: "stale:gold", group: "gold" as const, kind: "stale" as const, severity: "warn" as const, message: "黄金没有更新到最新交易日：上海金", items: ["上海金"] }] };
    expect(buildStrip(health, observations, NOW).map((i) => [i.label, i.text])).toEqual([
      ["数据异常", "黄金没有更新到最新交易日：上海金"],
      ["大幅波动", "纳斯达克100 11月1日下跌 3.5%"],
      ["申购变化", "019172 申购额度收紧：限大额 · 10 元/日 → 暂停申购"],
      ["可以考虑停止", "A组 · 022502 暂停申购"],
    ]);
    expect(buildStrip(null, [], new Date("2026-12-20T02:00:00Z")).map((i) => i.text)).toEqual(["个人养老金本年度缴存 12月31日截止，还有 11 天"]);
  });

  it("loads the newest weekly note", async () => {
    const note = await loadLatestOutlook();
    expect(note?.date).toBe("2026-11-02");
    expect(note?.assets.map((a) => a.id)).toEqual(["us", "cn", "gold", "bonds", "fx"]);
    expect(note?.assets.every((a) => a.drivers.every((d) => d.sources.length > 0))).toBe(true);
    expect(JSON.stringify(note)).not.toMatch(/\d+\s*元\/月|每月\s*\d/);
  });
});
