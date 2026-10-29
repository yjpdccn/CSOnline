import { LlmStop, type LlmClient } from "@/lib/pipeline/llm";
import { translatedTitle, truncate } from "@/lib/pipeline/text";
import { formatDay } from "@/lib/time";
import type { RankedCard } from "./news";
import { describeBp, describeMove, formatNumber } from "./quotes";
import type { InvestNewsItem, OverviewFile, QuoteView } from "./types";

export interface OverviewQuotes {
  us: QuoteView[];
  cn: QuoteView[];
  gold: QuoteView[];
  rates: QuoteView[];
}

const shortDay = (day: string) => formatDay(day).split(" ")[0];

function moves(quotes: QuoteView[]): string {
  return quotes.map((q) => `${q.name} ${describeMove(q.changePct)}`).join("，");
}

/** Overview without AI: the day's moves of the tracked markets and the top stories. */
export function buildAutoOverview(quotes: OverviewQuotes, ranked: RankedCard[], now: Date): OverviewFile {
  const parts: string[] = [];
  if (quotes.us.length) parts.push(`美股（${shortDay(quotes.us[0].date)}）：${moves(quotes.us)}`);
  if (quotes.cn.length) parts.push(`A股（${shortDay(quotes.cn[0].date)}）：${moves(quotes.cn)}`);
  const [spot, shanghai] = quotes.gold;
  if (spot) {
    const sh = shanghai ? `，上海金 ${formatNumber(shanghai.last, shanghai.decimals)} ${shanghai.unit ?? ""}`.trimEnd() : "";
    parts.push(`黄金：现货 ${formatNumber(spot.last, spot.decimals)} ${spot.unit ?? ""}（${describeMove(spot.changePct)}）${sh}`);
  }
  const rates = quotes.rates
    .map((q) => `${q.name} ${formatNumber(q.last, q.decimals)}${q.unit === "%" ? "%" : ""}${q.yieldSeries ? `（${describeBp(q.changeBp)}）` : q.changePct !== undefined ? `（${describeMove(q.changePct)}）` : ""}`)
    .join("，");
  if (rates) parts.push(rates);
  const points = ranked.slice(0, 5).map(({ item }) => ({ text: translatedTitle(item) ?? item.title, refs: [item.id] }));
  return {
    generatedAt: now.toISOString(),
    mode: "fallback",
    text: parts.length ? `${parts.join("。")}。` : "暂无行情数据。",
    points,
  };
}

/** Advice the page must never give, from the model or anywhere else. */
const ADVICE = /建议|买入|卖出|加仓|减仓|抄底|逃顶|止盈|止损|推荐|值得买|上车|应该|择机|布局/;

const OVERVIEW_SYSTEM = `你是财经编辑，为长期定投指数基金和黄金的读者写「市场概览」。输入是行情（指数涨跌、金价、美元指数、美债收益率）和按重要性排序的新闻。
- overview：2～3 句话，不超过 120 个汉字，概括美股、A股、黄金和利率的变化及主要原因。只依据输入，不预测走势。
- points：3～5 条要点，每条不超过 40 个汉字，每条附最相关新闻的 id 列表 refs。
- 只陈述事实，不给任何买卖、加减仓或配置建议，不用「建议」「应该」「值得」之类的措辞。
只输出 JSON：{"overview":"...","points":[{"text":"...","refs":["id"]}]}`;

interface OverviewResult {
  overview?: string;
  points?: { text?: string; refs?: string[] }[];
}

export async function generateAiOverview(client: LlmClient, quotes: OverviewQuotes, ranked: RankedCard[], deadline: number, now: Date): Promise<OverviewFile> {
  const top = ranked.slice(0, 12).map(({ item }) => item);
  const ids = new Set(top.map((i) => i.id));
  const quote = (q: QuoteView) => ({
    name: q.name,
    date: q.date,
    last: q.last,
    ...(q.yieldSeries ? { change_bp: q.changeBp } : { change_pct: q.changePct }),
    ...(q.unit ? { unit: q.unit } : {}),
  });
  const payload = {
    quotes: [...quotes.us, ...quotes.cn, ...quotes.gold, ...quotes.rates].map(quote),
    news: top.map((i) => ({ id: i.id, source: i.sourceName, title: translatedTitle(i) ?? i.title, summary: truncate(i.ai?.summary || i.excerpt || "", 80) })),
  };
  const result = await client.chatJson<OverviewResult>(
    [
      { role: "system", content: OVERVIEW_SYSTEM },
      { role: "user", content: JSON.stringify(payload) },
    ],
    { maxTokens: 1200, deadline, tries: 2 },
  );
  const text = result.overview?.trim();
  const points = (result.points ?? [])
    .filter((p) => p?.text?.trim())
    .slice(0, 5)
    .map((p) => ({ text: truncate(p.text!.trim(), 50), refs: (p.refs ?? []).map(String).filter((id) => ids.has(id)) }));
  if (!text || !points.length) throw new Error("模型未返回有效的概览");
  if (ADVICE.test(text) || points.some((p) => ADVICE.test(p.text))) throw new Error("模型输出含建议性措辞，已改用自动概览");
  return { generatedAt: now.toISOString(), mode: "ai", model: client.config.model, text: truncate(text, 160), points };
}

const TITLE_SYSTEM = `把英文财经新闻改写成中文，读者只看中文。逐条处理：
- zh_title：中文标题，不超过 30 个汉字，准确克制，公司、人名、指数等专有名词可保留英文。
- summary：一句话中文摘要，不超过 50 个汉字，只依据给出的标题和摘要，不编造数字。
只输出 JSON：{"items":[{"id":"...","zh_title":"...","summary":"..."}]}，id 与输入一致。`;

interface TitleResult {
  items?: { id?: string; zh_title?: string; summary?: string }[];
}

const CHINESE = /[\u3400-\u9fff]/;

/** One request: Chinese titles for the top English stories. Returns how many items got one. */
export async function translateHeadlines(client: LlmClient, items: InvestNewsItem[], deadline: number): Promise<number> {
  if (!items.length) return 0;
  const result = await client.chatJson<TitleResult>(
    [
      { role: "system", content: TITLE_SYSTEM },
      { role: "user", content: JSON.stringify({ items: items.map((i) => ({ id: i.id, title: truncate(i.title, 200), excerpt: truncate(i.excerpt ?? "", 240) })) }) },
    ],
    { maxTokens: 400 + 120 * items.length, deadline, tries: 1 },
  );
  const byId = new Map((result.items ?? []).filter((r) => r?.id).map((r) => [String(r.id), r]));
  const at = new Date().toISOString();
  let done = 0;
  for (const item of items) {
    const r = byId.get(item.id);
    const title = r?.zh_title?.trim();
    if (!title || !CHINESE.test(title)) continue;
    item.ai = { title: truncate(title, 40), summary: r?.summary?.trim() ? truncate(r.summary.trim(), 80) : undefined, model: client.config.model, at };
    done++;
  }
  return done;
}

export function stopReason(err: unknown): string {
  if (err instanceof LlmStop) return err.detail ? `${err.message}：${err.detail}` : err.message;
  return (err as Error).message;
}
