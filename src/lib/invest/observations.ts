import { FUNDS, INDICES, INVEST_RULES, INVEST_SITE, PLAN_GROUPS } from "@/config/invest";
import { zonedParts } from "@/lib/time";
import type { AlertEvent, AlertSeverity, FundView, Premium } from "./types";

/**
 * Everything the alert panel says, as observations: changes seen between runs, the checklist's section 五
 * rules applied to every tracked fund, and the monthly reminder. Keys stay the same while a situation lasts,
 * so status.json can give each one a firstSeen time and notifications only go out for new ones.
 */
export interface Observation {
  key: string;
  kind: "change" | "rule" | "reminder";
  /** Section 五 rule: 1 A-class shares, 2 no 增强, 3 premium, 4 fees. */
  rule?: 1 | 2 | 3 | 4;
  severity: AlertSeverity;
  code?: string;
  title: string;
  detail: string;
  /** When a change was seen. */
  at?: string;
}

export const RULES: { rule: 1 | 2 | 3 | 4; label: string; scope: string }[] = [
  { rule: 1, label: "规则一：场外基金用 A 类份额", scope: "C/E 类每年另收销售服务费；只看场外基金" },
  { rule: 2, label: "规则二：名称不含「增强」", scope: "所有关注的基金" },
  { rule: 3, label: "规则三：场内 QDII ETF 溢价以 2%–3% 为界", scope: "境内 ETF 和 LOF 只在偏离净值 1% 以上时列出" },
  { rule: 4, label: "规则四：指数基金管理费加托管费，A 股和黄金约 0.2%，QDII 1% 以内", scope: "只看指数基金，主动和债券基金不适用" },
];

const isQdii = (code: string) => INDICES.find((i) => i.id === FUNDS.find((f) => f.code === code)?.index)?.market === "us";

function premiumBasis(p: Premium): string {
  const day = `${Number(p.navDate.slice(5, 7))}月${Number(p.navDate.slice(8))}日`;
  if (p.kind === "domestic") return `按 ${day}收盘价和净值`;
  return `按 ${day}净值${p.estimated ? "和此后的指数涨跌估算" : ""}`;
}

const label = (code: string, views: FundView[]) => `${views.find((v) => v.code === code)?.name ?? FUNDS.find((f) => f.code === code)?.name ?? code}（${code}）`;

type ChangeEvent = AlertEvent & { kind: "limit-down" | "limit-up" | "fee-change" };

// Premium changes are left to the rule 3 observations, whose keys change with the band.
const isChange = (e: AlertEvent): e is ChangeEvent => e.kind === "limit-down" || e.kind === "limit-up" || e.kind === "fee-change";

function changeObservation(event: ChangeEvent, views: FundView[]): Observation {
  const fund = FUNDS.find((f) => f.code === event.code);
  const plan = Boolean(fund && PLAN_GROUPS.includes(fund.group));
  const name = label(event.code, views);
  const base = { key: event.id, kind: "change" as const, severity: event.severity, code: event.code, at: event.at };
  switch (event.kind) {
    case "limit-down":
      return { ...base, title: `${name} 申购额度收紧`, detail: `${event.from} → ${event.to}。${fund?.group === "dca" ? "按原金额定投可能扣款失败，记得核对定投金额。" : ""}` };
    case "limit-up":
      return { ...base, title: `${name} 申购额度放开`, detail: `${event.from} → ${event.to}。${plan && isQdii(event.code) ? "海外部分可投入的额度变大。" : ""}` };
    case "fee-change":
      return { ...base, title: `${name} 费率调整`, detail: `${event.from} → ${event.to}` };
  }
}

function ruleObservations(views: FundView[]): Observation[] {
  const out: Observation[] = [];
  const { low, high } = INVEST_RULES.premium;
  for (const view of views) {
    const name = `${view.name}（${view.code}）`;
    const service = view.fees?.service;
    // Without the fee page, the share class letter at the end of the name tells C/E shares apart.
    const serviceShares = service !== undefined ? service > 0 : /[CE]$/.test(view.name);
    if (!view.etf && serviceShares) {
      out.push({
        key: `rule1:${view.code}`,
        kind: "rule",
        rule: 1,
        severity: "warn",
        code: view.code,
        title: `${name} 是收销售服务费的份额`,
        detail: service ? `每年另收销售服务费 ${service.toFixed(2)}%，长期持有时比 A 类多付这部分费用。` : "C/E 类份额每年另收销售服务费，长期持有时比 A 类多付这部分费用。",
      });
    }
    if (/增强/.test(view.name)) {
      out.push({ key: `rule2:${view.code}`, kind: "rule", rule: 2, severity: "warn", code: view.code, title: `${name} 名称含「增强」`, detail: "增强型指数基金的费率通常高于普通指数基金。" });
    }
    const p = view.premium;
    if (p?.kind === "qdii") {
      const within = p.band === "low";
      out.push({
        key: `rule3:${view.code}:${within ? "within" : "above"}`,
        kind: "rule",
        rule: 3,
        severity: within ? "good" : p.band === "mid" ? "warn" : "bad",
        code: view.code,
        title: `${name} ${p.value < 0 ? "折价" : "溢价"} ${Math.abs(p.value).toFixed(2)}%`,
        detail: `${within ? `在规则三的 ${low}% 以内` : p.band === "mid" ? `在规则三的 ${low}%–${high}% 之间` : `高于规则三的 ${low}%–${high}%`}（${premiumBasis(p)}）。`,
      });
    } else if (p?.band === "unusual") {
      out.push({
        key: `rule3:${view.code}:unusual`,
        kind: "rule",
        rule: 3,
        severity: "warn",
        code: view.code,
        title: `${name} ${p.value < 0 ? "折价" : "溢价"} ${Math.abs(p.value).toFixed(2)}%`,
        detail: `偏离净值超过 ${INVEST_RULES.domesticPremium.unusual}%（${premiumBasis(p)}）。`,
      });
    }
    const fee = view.feeRule;
    if (fee && !fee.ok) {
      out.push({
        key: `rule4:${view.code}`,
        kind: "rule",
        rule: 4,
        severity: "warn",
        code: view.code,
        title: `${name} 费率 ${fee.total.toFixed(2)}%/年`,
        detail: fee.kind === "qdii" ? `管理费加托管费超过 QDII 基金 ${fee.cap}% 以内的线。` : `管理费加托管费高于 A 股和黄金指数基金约 ${fee.cap}% 的线。`,
      });
    }
  }
  return out;
}

export function buildObservations(events: AlertEvent[], views: FundView[], now: Date): Observation[] {
  const recent = events.filter((e): e is ChangeEvent => isChange(e) && now.getTime() - Date.parse(e.at) <= INVEST_SITE.alertDays * 86_400_000);
  const items = [...recent.map((e) => changeObservation(e, views)), ...ruleObservations(views)];
  const today = zonedParts(now);
  if (today.day <= INVEST_RULES.monthlyCheckDays) {
    items.push({
      key: `monthly:${today.year}-${String(today.month).padStart(2, "0")}`,
      kind: "reminder",
      severity: "info",
      title: `${today.month}月定投扣款核对`,
      detail: "到购买平台确认本月各项定投都已扣款成功（本站看不到账户，只能自己核对）。",
    });
  }
  return items;
}
