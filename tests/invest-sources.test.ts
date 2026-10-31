import { describe, expect, it } from "vitest";
import { parseFomcCalendar, selectCalendarEvents, type WscnCalendarItem } from "@/lib/invest/sources/calendar";
import { parseFeePage, parseLimit, parseNavHistory, parseProfilePage } from "@/lib/invest/sources/funds";
import {
  parseCsindex,
  parseDanjuan,
  parseEastmoneyLatest,
  parseKlines,
  parseSinaLatest,
  parseTencentKlines,
  parseTreasuryRealYields,
} from "@/lib/invest/sources/market";
import { clsSign, parseNbsList, splitFlash } from "@/lib/invest/sources/news";

describe("market sources", () => {
  it("reads 东方财富 daily closes", () => {
    const parsed = parseKlines({ data: { name: "纳斯达克100", klines: ["2026-10-27,29651.44", "2026-10-28,29813.16", "bad,line"] } });
    expect(parsed).toEqual({ name: "纳斯达克100", closes: [["2026-10-27", 29651.44], ["2026-10-28", 29813.16]] });
    expect(() => parseKlines({ data: null })).toThrow();
  });

  it("reads 腾讯行情 daily closes, the fallback for ETFs and the main indices", () => {
    const body = { data: { sh510300: { day: [["2026-10-28", "4.155", "4.152", "4.166", "4.132", "10986237.000"], ["2026-10-29", "4.145", "4.111", "4.146", "4.103", "21619193.000"]] } } };
    expect(parseTencentKlines(body, "sh510300").closes).toEqual([["2026-10-28", 4.152], ["2026-10-29", 4.111]]);
    expect(() => parseTencentKlines({ data: {} }, "sh510300")).toThrow();
  });

  it("reads latest values from 东方财富's delayed host, dated by the market's own day", () => {
    const map = parseEastmoneyLatest({
      data: {
        diff: [
          // 05:39 Beijing on Saturday is Friday afternoon in New York.
          { f2: 3875.55, f12: "XAU", f13: 122, f124: 1793393940 },
          { f2: 11380.1, f12: "H30269", f13: 2, f124: 1793348996 },
          { f2: 0, f12: "SHAU", f13: 118, f124: 1793361600 },
        ],
      },
    });
    expect(map.get("122.XAU")).toEqual({ date: "2026-10-30", value: 3875.55 });
    expect(map.get("2.H30269")).toEqual({ date: "2026-10-30", value: 11380.1 });
    expect(map.has("118.SHAU")).toBe(false);
    // China's 10-year yield refreshed early on Saturday is Friday's value.
    expect(parseEastmoneyLatest({ data: { diff: [{ f2: 1.655, f12: "CN10Y", f13: 171, f124: 1793394005 }] } }).get("171.CN10Y")?.date).toBe("2026-10-30");
  });

  it("reads latest values from 新浪 quote lines", () => {
    const text = [
      'var hq_str_hf_XAU="3876.69,4021.230,3876.69,3877.07,4026.24,3870.05,04:55:00,4021.23,4023.79,0,0,0,2026-10-31,伦敦金（现货黄金）";',
      'var hq_str_DINIW="05:41:42,101.9669,101.9669,101.8857,5052,101.9016,102.0903,101.5851,101.9669,美元指数,2026-10-31";',
      'var hq_str_globalbd_cn10yt="中国10年期国债,1.609,1.640,1.638,1.646,1.597,0,-0.1220,-0.0020,0,0,1793359095,2026-10-30,07:18:15";',
      'var hq_str_SGE_SHAU="SHAU,上海金,SHAU,--,--,--,--,--,--,--,--,--,--,--,--,--,2026-10-30 19:50:17,NaN%";',
    ].join("\n");
    const map = parseSinaLatest(text);
    expect(map.get("hf_XAU")).toEqual({ date: "2026-10-30", value: 3876.69 });
    expect(map.get("DINIW")).toEqual({ date: "2026-10-30", value: 101.9669 });
    expect(map.get("globalbd_cn10yt")).toEqual({ date: "2026-10-30", value: 1.609 });
    expect(map.has("SGE_SHAU")).toBe(false);
  });

  it("reads the 10-year column of the Treasury real yield CSV, oldest first", () => {
    const csv = 'Date,"5 YR","7 YR","10 YR","20 YR","30 YR"\n10/28/2026,2.36,2.51,2.67,2.96,3.10\n10/27/2026,2.37,2.50,2.64,2.91,3.05\n';
    expect(parseTreasuryRealYields(csv)).toEqual([["2026-10-27", 2.64], ["2026-10-28", 2.67]]);
  });

  it("reads 蛋卷基金 valuations with their percentile window", () => {
    const map = parseDanjuan({
      data: {
        items: [
          { index_code: "SH000300", name: "沪深300", pe: 12.8607, pb: 1.3666, pe_percentile: 0.5252, pb_percentile: 0.28, ts: 1793116800000, begin_at: 1468339200000 },
          { index_code: "SZ399393", name: "国证地产", pe: 0, pb: 0.75, pe_percentile: 0, pb_percentile: 0.1, ts: 1793116800000 },
        ],
      },
    });
    expect(map.get("SH000300")).toEqual({ pe: 12.8607, pePercentile: 0.5252, pb: 1.3666, pbPercentile: 0.28, date: "2026-10-28", since: "2016-07-13", source: "蛋卷基金" });
    expect(map.get("SZ399393")?.pe).toBeUndefined();
  });

  it("takes 中证指数 closes and the latest PE, without a percentile on a short history", () => {
    const parsed = parseCsindex({
      data: [
        { tradeDate: "20261027", close: 5016.04, peg: 14.2 },
        { tradeDate: "20261028", close: 4959.56, peg: 14.11 },
        { tradeDate: "20261029", close: 4884.9, peg: null },
      ],
    });
    expect(parsed.valuation).toEqual({ pe: 14.11, date: "2026-10-28", source: "中证指数" });
    expect(parsed.closes).toEqual([["2026-10-27", 5016.04], ["2026-10-28", 4959.56], ["2026-10-29", 4884.9]]);
  });

  it("computes the PE percentile when 中证指数's PE history covers five years", () => {
    const data = [
      { tradeDate: "20180131", close: 4000, peg: 14.26 },
      { tradeDate: "20210630", close: 5000, peg: 9 },
      { tradeDate: "20241231", close: 4500, peg: 11 },
      { tradeDate: "20261030", close: 4689.18, peg: 9.95 },
    ];
    expect(parseCsindex({ data }).valuation).toEqual({ pe: 9.95, pePercentile: 0.5, since: "2018-01-31", date: "2026-10-30", source: "中证指数" });
  });
});

describe("天天基金", () => {
  it("reads NAV history latest first", () => {
    const navs = parseNavHistory({ Data: { LSJZList: [{ FSRQ: "2026-10-27", DWJZ: "1.7454", JZZZL: "1.22" }, { FSRQ: "2026-10-26", DWJZ: "1.7243", JZZZL: "" }] } });
    expect(navs).toEqual([{ date: "2026-10-27", nav: 1.7454, changePct: 1.22 }, { date: "2026-10-26", nav: 1.7243 }]);
  });

  it("parses daily purchase limits", () => {
    expect(parseLimit("10.00元")).toBe(10);
    expect(parseLimit("7500.00万元")).toBe(75_000_000);
    expect(parseLimit("无限额")).toBeNull();
    expect(parseLimit(undefined)).toBeUndefined();
  });

  it("reads purchase status, daily limit and fees from the 基金费率 page", () => {
    const html = `<div class="boxitem"><table class="w770 comm jjfl"><tbody>
      <tr><td class="th w110">申购状态</td><td class="w135">限大额</td><td class="th w110">赎回状态</td><td class="w135">开放赎回</td><td class="th w110">定投状态</td><td class="w135">支持</td></tr>
      </tbody></table>
      <table class="w770 comm jjfl"><tbody><tr><td class="th w110">申购起点</td><td class="w135">10.00元</td><td class="th w110">日累计申购限额</td><td class="w135">10.00元</td></tr></tbody></table>
      <table class="w770 comm jjfl"><tbody><tr><td class="th w110">管理费率</td><td class="w135">0.50%（每年）</td><td class="th w110">托管费率</td><td class="w135">0.10%（每年）</td><td class="th w110">销售服务费率</td><td class="w135">0.00%（每年）</td></tr></tbody></table></div>`;
    expect(parseFeePage(html)).toEqual({
      status: { purchase: "限大额", redeem: "开放赎回", dca: "支持", limit: 10 },
      fees: { management: 0.5, custody: 0.1, service: 0 },
    });
  });

  it("reads the tracked index from the 基本概况 page, malformed cells included", () => {
    const html = `<table><tr><th>基金简称</th><td>大成标普500等权重指数(QDII)A人民币</td></tr>
      <tr><th>基金代码</th><td>096001（前端）<th>基金类型</th><td>指数型-海外股票</td></tr>
      <tr><th>业绩比较基准</th><td>标普500等权重指数(全收益指数)</td><th>跟踪标的</th><td>S&amp;P 500 EQUAL WEIGHTED TOTAL RETURN</td></tr></table>`;
    expect(parseProfilePage(html)).toEqual({
      name: "大成标普500等权重指数(QDII)A人民币",
      type: "指数型-海外股票",
      index: "S&P 500 EQUAL WEIGHTED TOTAL RETURN",
      benchmark: "标普500等权重指数(全收益指数)",
    });
    expect(parseProfilePage("<table><tr><th>基金简称</th><td>易方达安和中短债A</td></tr><tr><th>跟踪标的</th><td>该基金无跟踪标的</td></tr></table>").index).toBeUndefined();
  });
});

describe("news sources", () => {
  it("splits 7x24 paragraphs into a headline and text", () => {
    expect(splitFlash("【美联储维持利率不变】美联储以10比2的投票结果维持利率。")).toEqual({ title: "美联储维持利率不变", excerpt: "美联储以10比2的投票结果维持利率。" });
    expect(splitFlash("财联社10月29日电，英国10年期国债收益率下跌3个基点，降至五周低点5.29%。")).toEqual({ title: "英国10年期国债收益率下跌3个基点，降至五周低点5.29%" });
    const long = splitFlash(
      "央行今日开展1150亿元7天期逆回购操作，操作利率1.40%，与此前持平。因今日有800亿元逆回购到期，实现净投放350亿元。业内人士表示，月末资金面整体平稳，银行间市场流动性保持合理充裕。",
    );
    expect(long.title).toBe("央行今日开展1150亿元7天期逆回购操作，操作利率1.40%，与此前持平");
    expect(long.excerpt).toContain("净投放");
  });

  it("signs 财联社 requests as its web app does", () => {
    const params = { app: "CailianpressWeb", os: "web", sv: "8.4.6" };
    expect(clsSign(params)).toMatch(/^[0-9a-f]{32}$/);
    expect(clsSign({ sv: "8.4.6", os: "web", app: "CailianpressWeb" })).toBe(clsSign(params));
  });

  it("reads the 国家统计局 release list", () => {
    const html = `<div class="list-content"><ul><li><a class="fl pc_1600" href="./202610/t20261027_1965697.html" title='2026年1—9月份全国规模以上工业企业利润增长15.5%'>x</a><span> 2026-10-27 </span></li></ul></div>`;
    expect(parseNbsList(html, "https://www.stats.gov.cn/sj/zxfb/")).toEqual([
      {
        title: "2026年1—9月份全国规模以上工业企业利润增长15.5%",
        url: "https://www.stats.gov.cn/sj/zxfb/202610/t20261027_1965697.html",
        publishedAt: "2026-10-27T02:00:00.000Z",
        dateOnly: true,
      },
    ]);
  });
});

describe("calendar sources", () => {
  it("turns the Fed's meeting calendar into statement times at 2 p.m. Eastern", () => {
    const html = `<h4><a id="42828">2026 FOMC Meetings</a></h4>
      <div class="fomc-meeting__month col-xs-5"><strong>October</strong></div>
      <div class="fomc-meeting__date col-xs-4">27-28</div>
      <div class="fomc-meeting__month col-xs-5"><strong>December</strong></div>
      <div class="fomc-meeting__date col-xs-4">8-9*</div>`;
    // 2 p.m. EDT on Oct 28 and 2 p.m. EST on Dec 9.
    expect(parseFomcCalendar(html)).toEqual(["2026-10-28T18:00:00.000Z", "2026-12-09T19:00:00.000Z"]);
  });

  it("keeps key US/China data and rate decisions, groups same-time releases and flags unknown times", () => {
    const at = (iso: string) => Date.parse(iso) / 1000;
    const items: WscnCalendarItem[] = [
      { id: 1, public_date: at("2026-11-06T13:30:00Z"), country: "美国", title: "10月非农就业人口变动(万人)", importance: 4, calendar_type: "FD", previous: "2.9", forecast: "6.5" },
      { id: 2, public_date: at("2026-11-06T13:30:00Z"), country: "美国", title: "10月失业率", importance: 3, calendar_type: "FD" },
      { id: 3, public_date: at("2026-11-06T13:30:00Z"), country: "美国", title: "10月平均每小时工资环比", importance: 2, calendar_type: "FD" },
      { id: 4, public_date: at("2026-10-29T13:15:00Z"), country: "欧元区", title: "欧洲央行主要再融资利率", importance: 4, calendar_type: "FD" },
      { id: 5, public_date: at("2026-11-02T08:00:00Z"), country: "英国", title: "10月制造业PMI终值", importance: 3, calendar_type: "FD" },
      { id: 6, public_date: at("2026-11-07T04:02:00Z"), country: "中国", title: "10月外汇储备(亿美元)", importance: 4, calendar_type: "FD" },
      { id: 7, public_date: at("2026-10-30T04:02:00Z"), country: "美国", title: "Anthropic IPO 窗口", importance: 4, calendar_type: "FE" },
      { id: 8, public_date: at("2026-10-30T02:30:00Z"), country: "日本", title: "日本央行公布利率决议", importance: 4, calendar_type: "FE" },
    ];
    const events = selectCalendarEvents(items);
    expect(events.map((e) => e.title)).toEqual(["欧洲央行主要再融资利率", "日本央行公布利率决议", "10月非农就业人口变动(万人) · 10月失业率", "10月外汇储备(亿美元)"]);
    expect(events[2]).toMatchObject({ importance: 4, previous: "2.9", forecast: "6.5", kind: "data" });
    expect(events[3].dateOnly).toBe(true);
  });
});
