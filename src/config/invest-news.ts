import type { Market } from "./invest";

/**
 * 投资日报的新闻来源与话题规则。所有来源都在 2026-10-29 从美国的服务器验证过：免登录、可直接访问。
 * 7x24 快讯量很大，只取各站的重要/焦点/央行/宏观栏目，再按话题规则过滤掉与关注品种无关的内容。
 */

export type InvestFeedType = "wscn" | "cls" | "eastmoney-724" | "sina-724" | "rss" | "nbs";

export interface InvestSource {
  id: string;
  name: string;
  type: InvestFeedType;
  url: string;
  lang: "zh" | "en";
  /** "official" marks central banks and statistics bureaus; their release leads a merged story. */
  group: "official" | "media-zh" | "media-en";
  /** How much a report from this source says about importance on its own. */
  authority: number;
  options?: Record<string, string | number | boolean>;
  enabled?: boolean;
}

export const INVEST_SOURCES: InvestSource[] = [
  // 中文 7x24
  { id: "wscn-global", name: "华尔街见闻", type: "wscn", url: "https://api-one-wscn.awtmt.com/apiv1/content/lives?channel=global-channel&client=pc&limit=100", lang: "zh", group: "media-zh", authority: 15, options: { pages: 6, minScore: 2 } },
  { id: "wscn-gold", name: "华尔街见闻·黄金", type: "wscn", url: "https://api-one-wscn.awtmt.com/apiv1/content/lives?channel=gold-channel&client=pc&limit=100", lang: "zh", group: "media-zh", authority: 15, options: { pages: 1, minScore: 1 } },
  { id: "wscn-us", name: "华尔街见闻·美股", type: "wscn", url: "https://api-one-wscn.awtmt.com/apiv1/content/lives?channel=us-stock-channel&client=pc&limit=100", lang: "zh", group: "media-zh", authority: 15, options: { pages: 1, minScore: 2 } },
  { id: "cls", name: "财联社", type: "cls", url: "https://www.cls.cn/v1/roll/get_roll_list", lang: "zh", group: "media-zh", authority: 15, options: { category: "red", pages: 2 } },
  { id: "em-focus", name: "东方财富", type: "eastmoney-724", url: "https://np-listapi.eastmoney.com/comm/web/getFastNewsList", lang: "zh", group: "media-zh", authority: 13, options: { column: 101, pageSize: 100 } },
  { id: "em-pboc", name: "东方财富·中国央行", type: "eastmoney-724", url: "https://np-listapi.eastmoney.com/comm/web/getFastNewsList", lang: "zh", group: "media-zh", authority: 13, options: { column: 118, pageSize: 50 } },
  { id: "em-cb", name: "东方财富·全球央行", type: "eastmoney-724", url: "https://np-listapi.eastmoney.com/comm/web/getFastNewsList", lang: "zh", group: "media-zh", authority: 13, options: { column: 119, pageSize: 50 } },
  { id: "em-commodity", name: "东方财富·商品", type: "eastmoney-724", url: "https://np-listapi.eastmoney.com/comm/web/getFastNewsList", lang: "zh", group: "media-zh", authority: 13, options: { column: 106, pageSize: 50 } },
  // 新浪 7x24 的宏观、央行、A股栏目
  { id: "sina", name: "新浪财经", type: "sina-724", url: "https://zhibo.sina.com.cn/api/zhibo/feed", lang: "zh", group: "media-zh", authority: 12, options: { tags: "1,7,10" } },
  // 英文媒体
  { id: "cnbc-economy", name: "CNBC", type: "rss", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258", lang: "en", group: "media-en", authority: 14 },
  { id: "cnbc-top", name: "CNBC", type: "rss", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114", lang: "en", group: "media-en", authority: 14 },
  { id: "ft-markets", name: "FT", type: "rss", url: "https://www.ft.com/markets?format=rss", lang: "en", group: "media-en", authority: 15 },
  { id: "marketwatch", name: "MarketWatch", type: "rss", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories", lang: "en", group: "media-en", authority: 12 },
  // 官方发布
  { id: "fed", name: "美联储", type: "rss", url: "https://www.federalreserve.gov/feeds/press_monetary.xml", lang: "en", group: "official", authority: 20, options: { topics: "fed" } },
  { id: "ecb", name: "欧洲央行", type: "rss", url: "https://www.ecb.europa.eu/rss/press.html", lang: "en", group: "official", authority: 14, options: { topics: "cb", match: "monetary policy|interest rates?|press conference" } },
  { id: "nbs", name: "国家统计局", type: "nbs", url: "https://www.stats.gov.cn/sj/zxfb/", lang: "zh", group: "official", authority: 18 },
];

export const ENABLED_INVEST_SOURCES = INVEST_SOURCES.filter((s) => s.enabled !== false);

export type InvestTopic =
  | "fed"
  | "pboc"
  | "cb"
  | "policy-cn"
  | "policy-us"
  | "macro-us"
  | "macro-cn"
  | "us-stocks"
  | "a-shares"
  | "gold"
  | "cb-gold"
  | "rates-fx"
  | "cn-bonds"
  | "qdii";

/** Countries and regions other than China; "英国9月央行…" is not about the PBOC. */
const FOREIGN =
  "欧洲|欧元区|日本|英国|美国|澳洲|澳大利亚|加拿大|新西兰|瑞士|瑞典|挪威|韩国|印度|俄罗斯|巴西|土耳其|泰国|墨西哥|南非|智利|印尼|菲律宾|越南|以色列|德国|法国|意大利|西班牙|阿根廷|沙特|新加坡";
export const FOREIGN_CONTEXT = new RegExp(`${FOREIGN}|全球央行|各国央行|多国央行|海外央行`);
/** Names China; with it, a foreign country in the same text does not rule out a China topic. */
export const CHINA_CONTEXT = /中国|我国|国内|人民币|A股|沪深|内地|国务院|人民银行|国家统计局|国家发改委/;
/** Topics only about China, dropped when the text is about another country. */
export const CHINA_TOPICS: InvestTopic[] = ["pboc", "policy-cn", "cn-bonds", "macro-cn", "a-shares"];

const MACRO_INDICATOR = /CPI|PCE|PPI|非农|就业人数|失业率|初请|失业救济|GDP|零售销售|ISM|PMI|消费者信心|职位空缺|JOLTS|通胀|密歇根|耐用品订单|工业产出|新屋|成屋/;
const MACRO_INDICATOR_EN = /\b(?:CPI|PCE|PPI|payrolls?|jobs report|jobless claims|GDP|retail sales|ISM|PMI|JOLTS)\b/i;
const CN_INDICATOR =
  /CPI|PPI|PMI|GDP|社融|社会融资|M2|M1|新增贷款|人民币贷款|进出口|出口同比|进口同比|出口增|进口增|贸易顺差|贸易差额|工业增加值|社会消费品零售|社零|固定资产投资|房地产开发投资|调查失业率|外汇储备|工业企业利润|国内生产总值|居民消费价格|生产者价格/;
const CN_MARKER = /中国|我国|全国|国家统计局|统计局|海关总署|规模以上|1[—–-]\d{1,2}月|人民银行|央行/;
const US_MARKER = /美国|美方|美联储|\bU\.?S\.?\b|\bAmerican\b/;
const NON_US_MARKER = /中国|英国|欧元区|德国|法国|日本|加拿大|澳大利亚|\b(?:China|Chinese|UK|Britain|euro ?zone|Germany|Japan|Canada|Australia)\b/;

/** Plain patterns per topic; macro topics also need a country, see `investTopics` in lib/invest/topics.ts. */
export const TOPIC_PATTERNS: Record<Exclude<InvestTopic, "macro-us" | "macro-cn">, RegExp[]> = {
  fed: [/美联储|联邦公开市场委员会|FOMC|鲍威尔|沃什|联邦基金利率/, /\bFed\b/, /\b(?:Federal Reserve|Powell|Warsh|fed funds)\b/i],
  // Plain 央行 counts too when no other country is named; see investTopics.
  pboc: [
    /中国人民银行|人民银行|人行|中国央行|潘功胜|降准|存款准备金率|贷款市场报价利率|\bLPR\b|中期借贷便利|\bMLF\b|逆回购|公开市场操作|买断式回购/,
    /\b(?:PBOC|PBoC|People's Bank of China)\b/,
  ],
  cb: [/欧洲央行|欧央行|日本央行|日银|英国央行|英格兰银行|拉加德|植田和男/, /\b(?:ECB|BOJ|BoJ|BoE)\b/, /\b(?:Bank of Japan|Bank of England|Lagarde|Ueda)\b/i],
  "policy-cn": [
    /国务院|国常会|政治局|中央经济工作会议|中央财经委|全国人大|证监会|金融监管总局|金融监督管理总局|发改委|发展改革委|(?<!美国)财政部/,
    /稳增长|特别国债|专项债|化债|增量政策|政策性金融工具|中央汇金|平准基金|印花税/,
  ],
  "policy-us": [
    /特朗普|白宫|关税|贝森特|美国财政部|政府停摆|债务上限|中期选举|美国国会/,
    /\b(?:Trump|White House|tariffs?|Bessent|Treasury Secretary|government shutdown|debt ceiling|midterms?)\b/i,
  ],
  "us-stocks": [
    /美股|标普500|标普|纳指|纳斯达克|道指|道琼斯|费城半导体|七巨头|美国股市|华尔街/,
    /\b(?:S&P 500|S&P|Nasdaq|Dow|Wall Street|stocks?|stock market|equities)\b/i,
    /(?:苹果|微软|英伟达|谷歌|亚马逊|特斯拉|博通|Alphabet|Meta|Apple|Microsoft|Nvidia|Amazon|Tesla|Broadcom).{0,20}(?:财报|业绩|营收|盈利|指引|earnings|results|revenue|guidance)/i,
  ],
  "a-shares": [/A股|沪指|上证指数|深成指|深证成指|创业板指|沪深300|中证A500|A500|中证500|中证1000|科创50|两市成交|沪深两市|沪深京|北向资金|宽基ETF|红利低波|中证红利|中央汇金|国家队|险资入市|长线资金入市/],
  gold: [
    /金价|现货黄金|伦敦金(?![属融])|纽约金|COMEX ?黄金|黄金期货|黄金价格|黄金ETF|黄金 ETF|上海金|沪金|黄金T\+D|贵金属/,
    /黄金.{0,6}(?:涨|跌|新高|新低|走高|走低|下挫|反弹|突破|需求|避险)/,
    /\b(?:gold|bullion|precious metals?)\b/i,
  ],
  "cb-gold": [/增持黄金|黄金储备|购金|央行.{0,8}黄金|世界黄金协会/, /\b(?:gold reserves?|World Gold Council)\b/i, /\bcentral banks?\b.{0,40}\bgold\b/i],
  "rates-fx": [
    /美元指数|美债收益率|美国国债收益率|美债|实际利率|人民币汇率|离岸人民币|在岸人民币|人民币中间价|人民币兑美元|美元兑人民币/,
    /\b(?:dollar index|DXY|Treasury yields?|bond yields?|the dollar|real yields?|TIPS|yuan|renminbi)\b/i,
  ],
  "cn-bonds": [/债市|中债|国债期货|资金面|银行间|同业存单|信用债/, new RegExp(`(?<!${FOREIGN}|美|英|日|德|法|韩)10年期国债`)],
  qdii: [
    /QDII|跨境ETF|外汇额度/,
    /(?:纳指|标普|美股|海外|港股)ETF.{0,10}(?:溢价|限购|申购)/,
    /(?:限购|暂停申购|恢复申购|大额申购|申购限额).{0,20}(?:基金|QDII|ETF)|(?:基金|QDII|ETF).{0,20}(?:限购|暂停申购|恢复申购|大额申购|申购限额|溢价)/,
  ],
};

export const MACRO_RULES = { MACRO_INDICATOR, MACRO_INDICATOR_EN, CN_INDICATOR, CN_MARKER, US_MARKER, NON_US_MARKER };

/** Company filings: "江苏银行：第三季度归母净利润…" or "某某Q3新进成为…股东" say nothing about an index. */
export const COMPANY_FILING = {
  prefix: /^[^，。：:\s]{2,16}[：:]/,
  terms: /净利润|营业收入|营收|归母|扣非|回购|减持|增持股份|股东|中标|签订|合同|定增|分红|派息|业绩预告|季报|年报|半年报|董事长|总经理|辞职|质押|解禁/,
  holder: /(?:新进|退出|位列)(?:成为)?.{0,12}(?:前十大|第[一二三四五六七八九十]+大)?(?:流通)?股东/,
};

/** Agendas, reminders and morning roundups list many stories; they are not news themselves. */
export const ROUNDUP = /^提醒[：:]|早餐|早报|晚报|日内请重点关注|今日重点关注|今日关注|隔夜全球要闻|你需要知道的|一周前瞻|下周前瞻|本周看点|财经日历/;

/** Explainers and look-backs rank below news of the day. */
export const EXPLAINER = /图解|一图|科普|盘点|复盘|历次|周报|月报/;

/**
 * Finance words that tell little about which event a headline reports, for the cross-source merge:
 * two 美联储 headlines on one day can be a preview, the decision and a reaction.
 */
export const FINANCE_GENERIC = new Set(
  (
    "美联 联储 利率 率决 央行 市场 指数 美元 美股 股市 经济 政策 决议 声明 预计 预期 机构 美国 中国 全球 数据 金价 黄金 价格 " +
    "收盘 开盘 上涨 下跌 基点 主席 表示 认为 关注 要点 分析 前瞻 回应 影响 风险 板块 个股 期货 现货 盘中 盘前 盘后 午盘 " +
    "高开 低开 涨幅 跌幅 涨超 跌超 大涨 大跌 季度 本周 今日 投资 资金 债券 国债 收益 益率 通胀 就业 继续 可能 或将 " +
    "fed rate rates stocks stock market markets investors economy inflation yields dollar gold price prices says wall street shares index"
  ).split(" "),
);

/** Headline signals that make a story matter more, on top of source authority and coverage. */
export const IMPORTANCE_SIGNALS: { re: RegExp; bonus: number }[] = [
  {
    re: /利率决议|议息|降息|加息|降准|维持利率|按兵不动|\bFOMC statement\b|\bmonetary policy decisions?\b|\brate (?:decision|cuts?|hikes?)\b|\b(?:cuts?|raises?|holds?|keeps?) (?:interest )?rates\b/i,
    bonus: 12,
  },
  { re: /(?:公布|录得|前值|预期|好于|不及|超预期|升至|降至)|\b(?:rose|fell|beat|missed|came in)\b/i, bonus: 4 },
  { re: /收盘|收涨|收跌|收报|\bclose[sd]?\b/i, bonus: 3 },
  { re: /历史新高|创新高|\brecord high\b|\ball-time high\b/i, bonus: 4 },
];

export const TOPIC_BONUS: Partial<Record<InvestTopic, number>> = { fed: 6, pboc: 6, "macro-us": 5, "macro-cn": 5, qdii: 6, "cb-gold": 6 };

/** News filter tabs on the page. */
export const TOPIC_FILTERS: { id: string; label: string; topics: InvestTopic[] }[] = [
  { id: "policy", label: "央行与政策", topics: ["fed", "pboc", "cb", "policy-cn", "policy-us"] },
  { id: "macro", label: "宏观数据", topics: ["macro-us", "macro-cn"] },
  { id: "us", label: "美股", topics: ["us-stocks"] },
  { id: "cn", label: "A股", topics: ["a-shares"] },
  { id: "gold", label: "黄金", topics: ["gold", "cb-gold"] },
  { id: "rates", label: "利率汇率", topics: ["rates-fx", "cn-bonds"] },
  { id: "qdii", label: "QDII", topics: ["qdii"] },
];

/** Topics that move each market; the first is the market's own topic and ranks first on its card. */
export const MARKET_TOPICS: Record<Market, InvestTopic[]> = {
  us: ["us-stocks", "fed", "macro-us", "policy-us", "rates-fx", "qdii"],
  cn: ["a-shares", "pboc", "macro-cn", "policy-cn"],
  gold: ["gold", "cb-gold", "fed", "rates-fx", "macro-us", "cb"],
  bond: ["cn-bonds", "pboc", "macro-cn"],
};
