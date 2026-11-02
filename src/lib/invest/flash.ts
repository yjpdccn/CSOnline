import { normalizeHeadline } from "@/lib/pipeline/similarity";
import { titleFingerprint, titleSimilarity } from "@/lib/pipeline/text";
import type { NewsItem } from "@/lib/types";

/**
 * Same-event matching for short finance flashes (财联社, 华尔街见闻, 东方财富 and 新浪 7x24). A flash is
 * reduced to who it is about (central bank, regulator, index, commodity, company), what kind of event it
 * reports (a session report, an open-market operation, a data release, a rate decision…) and its figures
 * (percentages, basis points, amounts, index points). Two flashes are one event when they share the same
 * who and what within that event's time window, or the same who and figure within a few hours.
 */
export interface FlashSignature {
  entities: Set<string>;
  events: Set<string>;
  figures: Set<string>;
  months: Set<string>;
  countries: Set<string>;
  markets: Set<string>;
}

const ENTITIES: [string, RegExp][] = [
  ["cb:ecb", /欧洲央行|欧央行|\bECB\b|拉加德/],
  ["cb:boj", /日本央行|日央行|\bBOJ\b|植田/],
  ["cb:boe", /英国央行|英央行|英格兰银行|\bBOE\b|Bank of England/i],
  ["cb:rba", /澳洲联储|澳联储|澳大利亚央行/],
  ["cb:snb", /瑞士央行|瑞士国家银行/],
  ["cb:boc", /加拿大央行/],
  ["cb:fed", /(?<!澳洲|澳|新西兰)联储|FOMC|鲍威尔|沃什|\bFed\b|Federal Reserve/i],
  ["reg:csrc", /证监会/],
  ["reg:nfra", /金融监管总局|国家金融监督管理总局/],
  ["gov:council", /国务院|国常会/],
  ["gov:politburo", /政治局/],
  ["gov:ust", /美国财政部|贝森特|Treasury Secretary/i],
  ["idx:sse50", /上证50/],
  ["idx:star50", /科创50/],
  ["idx:sse", /上证指数|上证综指|沪指/],
  ["idx:szse", /深证成指|深成指/],
  ["idx:cyb", /创业板指|创业板/],
  ["idx:csi300", /沪深300/],
  ["idx:a500", /A500/],
  ["idx:csi500", /中证500/],
  ["idx:csi1000", /中证1000/],
  ["idx:hstech", /恒生科技|恒科/],
  ["idx:hsi", /恒生指数|恒指/],
  ["idx:dji", /道指|道琼斯/],
  ["idx:spx", /标普500|标普指数|S&P\s?500/i],
  ["idx:ndx", /纳指|纳斯达克|Nasdaq/i],
  ["idx:sox", /费城半导体|费半/],
  ["idx:nikkei", /日经225|日经指数|日经平均/],
  ["idx:vix", /\bVIX\b|恐慌指数/i],
  ["cmd:gold", /黄金|金价|沪金|伦敦金|现货金|COMEX金/],
  ["cmd:silver", /白银|银价|沪银/],
  ["cmd:oil", /原油|油价|布伦特|\bWTI\b|美油/],
  ["cmd:copper", /铜价|沪铜|伦铜/],
  ["fx:cny", /人民币|中间价/],
  ["fx:dxy", /美元指数/],
  ["bond:ust", /美债|美国国债|美国政府债券/],
  ["bond:cgb", /中债|国债期货|中国国债/],
  ["co:apple", /苹果|Apple/],
  ["co:nvidia", /英伟达|Nvidia/i],
  ["co:tesla", /特斯拉|Tesla/i],
  ["co:microsoft", /微软|Microsoft/i],
  ["co:amazon", /亚马逊|Amazon/i],
  ["co:meta", /\bMeta\b/],
  ["co:alphabet", /谷歌|Alphabet|Google/i],
  ["co:amd", /\bAMD\b/],
  ["co:intel", /英特尔|Intel/i],
  ["co:tsmc", /台积电|TSMC/i],
  ["co:broadcom", /博通|Broadcom/i],
  ["co:moutai", /茅台/],
  ["co:catl", /宁德时代/],
  ["co:byd", /比亚迪/],
  ["co:tencent", /腾讯/],
  ["co:alibaba", /阿里巴巴|阿里/],
  ["co:xiaomi", /小米/],
  ["co:smic", /中芯国际/],
];

/** "央行" alone, once the foreign central banks are taken out, is China's. */
const PBOC = /中国央行|中国人民银行|人民银行|人行|央行|PBOC/;

const MARKET_OF: Record<string, string> = {
  "idx:sse50": "cn", "idx:star50": "cn", "idx:sse": "cn", "idx:szse": "cn", "idx:cyb": "cn", "idx:csi300": "cn", "idx:a500": "cn", "idx:csi500": "cn", "idx:csi1000": "cn",
  "idx:hstech": "hk", "idx:hsi": "hk",
  "idx:dji": "us", "idx:spx": "us", "idx:ndx": "us", "idx:sox": "us", "idx:vix": "us",
  "idx:nikkei": "jp",
};

const EVENTS: [string, RegExp][] = [
  ["session:open", /开盘|高开|低开/],
  ["session:midday", /午盘|午间收盘|半日/],
  ["session:close", /收盘|收涨|收跌|尾盘|收报/],
  ["omo", /逆回购|公开市场|\bMLF\b|中期借贷便利|买断式|国债买卖|净投放|净回笼|互换便利|\bSFISF\b/],
  ["lpr", /\bLPR\b|贷款市场报价利率/],
  ["rrr", /降准|存款准备金率/],
  ["decision", /利率决议|利率决定|议息|按兵不动|维持利率|主要再融资利率|联邦基金利率|宣布(?:加息|降息)|(?:上调|下调)(?:基准|政策)?利率/],
  ["fedwatch", /(?:加息|降息)的?概率|利率期货|FedWatch|利率掉期/i],
  ["meeting", /座谈会|研讨会|吹风会|新闻发布会/],
  ["refunding", /再融资(?!利率)|债发行|发债|标售|拍卖/],
  ["fixing", /中间价/],
  ["data:pmi", /\bPMI\b|采购经理指数|采购经理人指数/],
  ["data:cpi", /\bCPI\b|消费者物价|居民消费价格/],
  ["data:ppi", /\bPPI\b|生产者物价|工业生产者出厂/],
  ["data:pce", /\bPCE\b|个人消费支出/],
  ["data:gdp", /\bGDP\b|国内生产总值/],
  ["data:jobs", /非农|就业人数|失业率|初请/],
  ["data:retail", /零售销售|社会消费品零售/],
  ["data:trade", /进出口|贸易顺差|贸易差额|出口同比|进口同比/],
  ["data:credit", /社融|社会融资|新增贷款|\bM2\b|\bM1\b/],
  ["data:reserves", /外汇储备|黄金储备/],
  ["data:profit", /工业企业利润/],
];

/** "符合预期" reports an outcome; "预期" on its own looks ahead. */
export const COMMENTARY = /预判|前瞻|看点|预计|(?<!符合|符合市场|不及|超|超出|高于|低于)预期|或将|可能|料将|有望|质疑|点评|解读|怎么看|分析|押注|概率/;

/** A PMI is one release only within the same survey. */
const PMI_SURVEY: [string, RegExp][] = [
  ["private", /RatingDog|财新|标普全球|S&P Global/i],
  ["ism", /\bISM\b/],
  ["chicago", /芝加哥/],
];

const COUNTRIES: [string, RegExp][] = [
  ["cn", /中国|国家统计局|统计局|我国|全国/],
  ["us", /美国|美联储/],
  ["ez", /欧元区|德国|法国|意大利|欧洲/],
  ["jp", /日本/],
  ["uk", /英国/],
];

/** Kinds of report repeated every day; merged reports of them should not rank as big stories. */
export const ROUTINE_EVENTS = new Set(["session:open", "session:midday", "session:close", "omo", "fedwatch", "fixing"]);

const cache = new WeakMap<object, FlashSignature>();

export function flashSignature(title: string): FlashSignature {
  const text = title.normalize("NFKC");
  const entities = new Set<string>();
  let rest = text;
  for (const [key, re] of ENTITIES) {
    if (re.test(rest)) {
      entities.add(key);
      if (key.startsWith("cb:") && key !== "cb:fed") rest = rest.replace(new RegExp(re.source, "g" + re.flags.replace("g", "")), " ");
    }
  }
  if (PBOC.test(rest.replace(/美联储|联储|(?:全球|各国|多国|主要)央行/g, " "))) entities.add("cb:pboc");
  const events = new Set<string>();
  for (const [key, re] of EVENTS) if (re.test(text)) events.add(key);
  // Previews and commentary name the decision without reporting it.
  if (events.has("decision") && COMMENTARY.test(text)) events.delete("decision");
  if (events.has("data:pmi")) events.add(`pmi:${PMI_SURVEY.find(([, re]) => re.test(text))?.[0] ?? "main"}`);
  const figures = new Set<string>();
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(?:个)?(?:基点|bps?|BP)(?![a-z])/gi)) figures.add(`bp:${Number(m[1])}`);
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(万亿|亿|万)?\s*(美元|元|人民币|港元)/g)) {
    const value = Number(m[1].replace(/,/g, "")) * (m[2] === "万亿" ? 1e12 : m[2] === "亿" ? 1e8 : m[2] === "万" ? 1e4 : 1);
    figures.add(`${m[3] === "美元" ? "usd" : "cny"}:${value.toPrecision(3)}`);
  }
  for (const m of text.matchAll(/(\d{3,6}(?:\.\d+)?)\s*点/g)) figures.add(`pt:${Number(m[1])}`);
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) figures.add(`pct:${Number(m[1])}`);
  const months = new Set<string>();
  for (const m of text.matchAll(/(?<![\d.])(\d{1,2})\s*(?:月份|月)(?!\d*日)/g)) months.add(String(Number(m[1])));
  const countries = new Set<string>();
  for (const [key, re] of COUNTRIES) if (re.test(text)) countries.add(key);
  const markets = new Set<string>();
  for (const e of entities) if (MARKET_OF[e]) markets.add(MARKET_OF[e]);
  if (/A股|沪深|两市|沪深两市/.test(text)) markets.add("cn");
  if (/港股/.test(text)) markets.add("hk");
  if (/美股/.test(text)) markets.add("us");
  return { entities, events, figures, months, countries, markets };
}

function signatureOf(item: NewsItem): FlashSignature {
  let sig = cache.get(item);
  if (!sig) {
    sig = flashSignature(item.title);
    cache.set(item, sig);
  }
  return sig;
}

const shared = (a: Set<string>, b: Set<string>, filter: (x: string) => boolean = () => true) => [...a].filter((x) => filter(x) && b.has(x));

const MIN = 60_000;
const HOUR = 60 * MIN;

/** How long reports of one event of each kind keep coming. */
const EVENT_WINDOW: Record<string, number> = {
  omo: 8 * HOUR,
  lpr: 12 * HOUR,
  rrr: 12 * HOUR,
  decision: 16 * HOUR,
  fedwatch: 6 * HOUR,
  meeting: 12 * HOUR,
  refunding: 12 * HOUR,
};

/** Who can be the subject of each kind of event. */
const SUBJECTS: Record<string, RegExp> = {
  omo: /^cb:/,
  lpr: /^cb:pboc$/,
  rrr: /^cb:pboc$/,
  decision: /^cb:/,
  fedwatch: /^cb:fed$/,
  meeting: /^(?:cb|reg|gov):/,
  refunding: /^(?:bond|gov):/,
};

const beijingDay = (t: number) => new Date(t + 8 * HOUR).toISOString().slice(0, 10);

export interface FlashDecision {
  same: boolean;
  reason: string;
}

/**
 * The finance rules for one pair: a decision when they apply (merge, or a conflict that rules a merge out),
 * null to leave the pair to the general matcher.
 */
export function compareFlashes(a: NewsItem, b: NewsItem, gapMs: number): FlashDecision | null {
  const sa = signatureOf(a);
  const sb = signatureOf(b);
  const sessionA = [...sa.events].find((e) => e.startsWith("session:"));
  const sessionB = [...sb.events].find((e) => e.startsWith("session:"));
  const marketsA = [...sa.markets];
  const sameMarket = marketsA.length > 0 && marketsA.every((m) => sb.markets.has(m)) && [...sb.markets].every((m) => sa.markets.has(m));
  if (sessionA && sessionB) {
    if (sessionA !== sessionB && sameMarket) return { same: false, reason: "不同时段的行情" };
    if (sessionA === sessionB && sameMarket && gapMs <= 45 * MIN) return { same: true, reason: "同一时段的行情播报" };
  }

  const dataA = [...sa.events].filter((e) => e.startsWith("data:"));
  const sharedData = dataA.filter((e) => sb.events.has(e));
  if (sharedData.length) {
    const surveyA = [...sa.events].find((e) => e.startsWith("pmi:"));
    const surveyB = [...sb.events].find((e) => e.startsWith("pmi:"));
    const sameCountry = shared(sa.countries, sb.countries).length > 0;
    const sameMonth = shared(sa.months, sb.months).length > 0;
    const countryClash = sa.countries.size > 0 && sb.countries.size > 0 && !sameCountry;
    const monthClash = sa.months.size > 0 && sb.months.size > 0 && !sameMonth;
    if (surveyA && surveyB && surveyA !== surveyB) return { same: false, reason: "不同的 PMI 调查" };
    if (countryClash) return { same: false, reason: "不同国家的数据" };
    if ((sameCountry || sameMonth) && !monthClash && gapMs <= 12 * HOUR) return { same: true, reason: `同一数据发布（${sharedData[0].slice(5)}）` };
  }

  for (const event of Object.keys(EVENT_WINDOW)) {
    if (!sa.events.has(event) || !sb.events.has(event) || gapMs > EVENT_WINDOW[event]) continue;
    const subjects = shared(sa.entities, sb.entities, (e) => SUBJECTS[event].test(e));
    if (!subjects.length) continue;
    if (event === "omo" && beijingDay(Date.parse(a.publishedAt)) !== beijingDay(Date.parse(b.publishedAt))) continue;
    const banksA = [...sa.entities].filter((e) => e.startsWith("cb:"));
    const banksB = [...sb.entities].filter((e) => e.startsWith("cb:"));
    if (event === "decision" && banksA.length && banksB.length && !banksA.some((x) => banksB.includes(x))) continue;
    return { same: true, reason: `同一事件（${subjects[0]} ${event}）` };
  }

  // The same instrument or company with the same figure, close together: "现货黄金跌破3900美元" twice.
  // Central banks are left out: 2% targets and 25bp steps recur in every official's remarks.
  if (gapMs <= 3 * HOUR) {
    const figures = shared(sa.figures, sb.figures, (f) => !/^pct:(?:0|0\.\d)$/.test(f));
    const subjects = shared(sa.entities, sb.entities, INSTRUMENT);
    if (figures.length && subjects.length) return { same: true, reason: `同一主体和数字（${subjects[0]} ${figures[0]}）` };
  }

  // One official's speech arrives as a burst of flashes: "美联储理事穆萨莱姆：…" several times within the hour.
  const speakerA = speakerOf(a.title);
  const speakerB = speakerOf(b.title);
  const banks = shared(sa.entities, sb.entities, (e) => e.startsWith("cb:"));
  if (speakerA && speakerB && banks.length) {
    if (!sameName(speakerA, speakerB)) return { same: false, reason: "不同官员的讲话" };
    if (gapMs <= 2 * HOUR) return { same: true, reason: `同一场讲话（${speakerA}）` };
  }

  if (nearIdenticalTitles(a.title, b.title)) return null;
  const banksA = [...sa.entities].filter((e) => e.startsWith("cb:"));
  const banksB = [...sb.entities].filter((e) => e.startsWith("cb:"));
  if (banksA.length && banksB.length && !banksA.some((x) => banksB.includes(x))) return { same: false, reason: "不同的央行" };
  // Word overlap alone links unrelated flashes about the same subject ("欧洲央行A说…" / "欧洲央行B说…")
  // or different instruments ("纳指期货跌幅扩大" / "国债期货跌幅扩大").
  const instrumentsA = [...sa.entities].filter(INSTRUMENT);
  const instrumentsB = [...sb.entities].filter(INSTRUMENT);
  if (instrumentsA.length && instrumentsB.length && !instrumentsA.some((x) => instrumentsB.includes(x))) return { same: false, reason: "不同的标的" };
  const sameInstrument = shared(sa.entities, sb.entities, INSTRUMENT).length > 0;
  const sameFigure = sameInstrument && shared(sa.figures, sb.figures).length > 0;
  if (shared(sa.entities, sb.entities).length && !shared(sa.events, sb.events).length && !sameFigure) {
    return { same: false, reason: "同一主体的不同消息" };
  }
  return null;
}

const INSTRUMENT = (e: string) => /^(?:idx|cmd|bond|fx|co):/.test(e);

const ROLE = /美联储|欧洲央行|欧央行|日本央行|英国央行|中国央行|央行|联储|副主席|主席|理事|官员|票委|行长|管委|执委|委员|首席经济学家|总裁|美国|日本|欧洲|英国|中国/g;

/** Central bank officials in Chinese (outlets transliterate differently) and English. */
const OFFICIALS: [string, RegExp][] = [
  ["powell", /鲍威尔|Powell/i],
  ["warsh", /沃什|Warsh/i],
  ["jefferson", /杰斐逊|Jefferson/i],
  ["bowman", /鲍曼|Bowman/i],
  ["cook", /库克|Lisa Cook/i],
  ["waller", /沃勒|Waller/i],
  ["williams", /威廉姆斯|John Williams/i],
  ["logan", /洛根|Logan/i],
  ["musalem", /穆萨[莱勒]姆|Musalem/i],
  ["hammack", /哈[玛马]克|Hammack/i],
  ["barkin", /巴尔金|Barkin/i],
  ["bostic", /博斯蒂克|Bostic/i],
  ["goolsbee", /古尔斯比|Goolsbee/i],
  ["kashkari", /卡什卡利|Kashkari/i],
  ["daly", /戴利|Daly/i],
  ["schmid", /施密德|Schmid/i],
  ["lagarde", /拉加德|Lagarde/i],
  ["lane", /连恩|莱恩|Philip Lane/i],
  ["schnabel", /施纳贝尔|Schnabel/i],
  ["makhlouf", /马赫[卢鲁]夫|Makhlouf/i],
  ["nagel", /纳格尔|Nagel/i],
  ["ueda", /植田|Ueda/i],
  ["bailey", /贝利|Andrew Bailey/i],
  ["pan", /潘功胜/],
  ["bessent", /贝森特|Bessent/i],
];

/** "美联储理事穆萨莱姆：…" and "St. Louis Fed's Musalem: …" → musalem. */
function speakerOf(title: string): string | undefined {
  const known = OFFICIALS.find(([, re]) => re.test(title));
  if (known) return known[0];
  const m = title.normalize("NFKC").match(/^([^：:，,。]{2,20})[：:]/);
  const name = m?.[1].replace(ROLE, "").trim();
  return name && Array.from(name).length >= 2 ? name : undefined;
}

/** Transliterations differ by a character between outlets: 穆萨莱姆 / 穆萨勒姆. */
function sameName(a: string, b: string): boolean {
  if (a === b) return true;
  const [x, y] = [Array.from(a), Array.from(b)];
  return x.length >= 3 && x.length === y.length && x.filter((c, i) => c !== y[i]).length <= 1;
}

function nearIdenticalTitles(a: string, b: string): boolean {
  const print = (t: string) => titleFingerprint(normalizeHeadline(t));
  return titleSimilarity(print(a), print(b)) >= 0.75;
}

/** The event kinds a card reports, for ranking routine reports lower. */
export function flashEvents(title: string): Set<string> {
  return flashSignature(title).events;
}
