import { INVEST_RULES, INVEST_SITE } from "@/config/invest";
import { zonedParts } from "@/lib/time";
import type { Observation, SuggestionAction } from "./observations";
import type { DataIssue, NotifyOutcome } from "./types";

/** What was already told, so each run only sends what is new or changed. Public: keys and short labels only. */
export interface NotifyFile {
  sent: Record<string, { hash: string; label: string; kind?: Observation["kind"] }>;
  issueNumber?: number;
  lastSentAt?: string;
  channel?: NotifyChannel;
  lastError?: string;
  /** Since when a message has been waiting for quiet hours to end. */
  held?: string;
}

/** 22:00–08:00 Beijing time by default. */
export function inQuietHours(now: Date): boolean {
  const { from, to } = INVEST_SITE.quietHours;
  const hour = zonedParts(now).hour;
  return from > to ? hour >= from || hour < to : hour >= from && hour < to;
}

export type NotifyChannel = NonNullable<NotifyOutcome["channel"]>;

export const ISSUE_TITLE = "投资日报提醒";

const issueHash = (i: DataIssue) => `${i.kind}:${[...i.items].sort().join(",")}`;

export interface NotifyDiff {
  issues: DataIssue[];
  resolved: string[];
  events: Observation[];
  suggestions: Observation[];
  reminders: Observation[];
  /** Fee suggestions too small to push one by one, told once a month as a count. */
  minorFees?: number;
  next: NotifyFile["sent"];
  /** No strategy suggestion was sent before: the message lists all there are. */
  first: boolean;
}

/** Events are news only while fresh; older ones (a run that started late, the first run) stay on the page. */
const EVENT_PUSH_MS = 24 * 3_600_000;

const isMinorFee = (a: Observation) => a.kind === "suggestion" && a.action === "replace" && (a.saving ?? Infinity) < INVEST_RULES.alternatives.pushSaving;

/**
 * New or changed since the last message: major events, strategy suggestions (fee savings only when material),
 * data problems that affect the page's numbers (and their recovery) and time reminders. Rule mismatches
 * and other changes stay on the page only.
 */
export function diffNotifications(sent: NotifyFile["sent"], issues: DataIssue[], alerts: Observation[], now = new Date()): NotifyDiff {
  const next: NotifyFile["sent"] = {};
  const first = !Object.values(sent).some((s) => s.kind === "suggestion");
  const fresh: NotifyDiff = { issues: [], resolved: [], events: [], suggestions: [], reminders: [], next, first };
  for (const issue of issues.filter((i) => i.severity === "warn")) {
    const key = `issue:${issue.key}`;
    const hash = issueHash(issue);
    next[key] = { hash, label: issue.message.split("：")[0] };
    if (sent[key]?.hash !== hash) fresh.issues.push(issue);
  }
  for (const [key, entry] of Object.entries(sent)) {
    if (key.startsWith("issue:") && !next[key]) fresh.resolved.push(entry.label);
  }
  const minor: Observation[] = [];
  for (const alert of alerts) {
    if (alert.kind !== "suggestion" && alert.kind !== "reminder" && alert.kind !== "event") continue;
    const key = `alert:${alert.key}`;
    if (sent[key]) {
      next[key] = sent[key];
      continue;
    }
    if (isMinorFee(alert)) {
      minor.push(alert);
      continue;
    }
    next[key] = { hash: alert.key, label: alert.title, kind: alert.kind };
    if (alert.kind === "event" && alert.at && now.getTime() - Date.parse(alert.at) > EVENT_PUSH_MS) continue;
    (alert.kind === "event" ? fresh.events : alert.kind === "suggestion" ? fresh.suggestions : fresh.reminders).push(alert);
  }
  const month = `fees:${now.toISOString().slice(0, 7)}`;
  if (sent[month]) next[month] = sent[month];
  else if (minor.length) {
    fresh.minorFees = minor.length;
    next[month] = { hash: month, label: "费率小建议", kind: "reminder" };
    for (const m of minor) next[`alert:${m.key}`] = { hash: m.key, label: m.title, kind: "suggestion" };
  }
  return fresh;
}

const MAX_SUGGESTIONS = 15;

export const ACTIONS: { action: SuggestionAction; title: string }[] = [
  { action: "stop", title: "可以考虑停止" },
  { action: "increase", title: "可以加大" },
  { action: "replace", title: "可以考虑替换" },
];

export function formatMessage(diff: NotifyDiff, pageUrl: string): { title: string; markdown: string } | null {
  const { issues, resolved, events, suggestions, reminders, minorFees } = diff;
  if (!issues.length && !resolved.length && !events.length && !suggestions.length && !reminders.length && !minorFees) return null;
  const lines: string[] = [];
  if (events.length) lines.push("**重大事件**", "", ...events.map((e) => `- ${e.title}${e.url ? `（[来源](${e.url})）` : ""}：${e.detail}`), "");
  let room = MAX_SUGGESTIONS;
  for (const { action, title } of ACTIONS) {
    const items = suggestions.filter((s) => s.action === action);
    const extra = action === "replace" && minorFees ? [`- 另有 ${minorFees} 条每年省费不到 ${INVEST_RULES.alternatives.pushSaving}% 的替换建议，见页面「策略建议」（每月最多提一次）。`] : [];
    if (action === "stop" && issues.length) lines.push("**数据异常**", "", ...issues.map((i) => `- ${i.message}`), "");
    if (action === "stop" && resolved.length) lines.push("**数据已恢复**", "", ...resolved.map((r) => `- ${r}`), "");
    if (!items.length && !extra.length) continue;
    lines.push(`**${title}**`, "", ...items.slice(0, room).map((s) => `- ${s.title}：${s.detail}`));
    if (items.length > room) lines.push(`- 另有 ${items.length - room} 条，见页面`);
    lines.push(...extra, "");
    room = Math.max(0, room - items.length);
  }
  if (reminders.length) lines.push("**时间提醒**", "", ...reminders.map((r) => `- ${r.title}：${r.detail}`), "");
  lines.push(`[打开投资日报](${pageUrl}) · [status.json](${pageUrl}status.json)`);
  const parts = [
    events.length && `${events.length} 项重大事件`,
    suggestions.length && `${suggestions.length} 条策略建议`,
    issues.length && `${issues.length} 项数据异常`,
    !issues.length && resolved.length && "数据已恢复",
    reminders.length && `${reminders.length} 条时间提醒`,
    !events.length && !suggestions.length && !issues.length && !resolved.length && !reminders.length && minorFees && "本月费率小建议",
  ].filter(Boolean);
  return { title: `投资日报：${parts.join("，")}`.slice(0, 32), markdown: lines.join("\n") };
}

type FetchLike = typeof fetch;

/**
 * Server酱 SendKey: Turbo keys (SCT…) post to sctapi.ftqq.com, Server酱³ keys (sctp{uid}t…) to their own host.
 */
export async function sendServerChan(sendKey: string, title: string, markdown: string, fetchImpl: FetchLike = fetch): Promise<void> {
  const v3 = sendKey.match(/^sctp(\d+)t/i);
  const res = v3
    ? await fetchImpl(`https://${v3[1]}.push.ft07.com/send/${sendKey}.send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, desp: markdown }),
        signal: AbortSignal.timeout(20_000),
      })
    : await fetchImpl(`https://sctapi.ftqq.com/${sendKey}.send`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ title, desp: markdown }).toString(),
        signal: AbortSignal.timeout(20_000),
      });
  const body = (await res.json().catch(() => ({}))) as { code?: number; message?: string; error?: string };
  if (!res.ok || (body.code !== undefined && body.code !== 0)) {
    throw new Error(`Server酱返回 ${res.status}${body.message || body.error ? `：${body.message || body.error}` : ""}`);
  }
}

interface GithubIssue {
  number: number;
  title: string;
  html_url: string;
  state: string;
  user?: { login?: string };
}

async function github<T>(fetchImpl: FetchLike, token: string, url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetchImpl(`https://api.github.com${url}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "invest-daily",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}：${(await res.text()).slice(0, 120)}`);
  return (await res.json()) as T;
}

/**
 * Comments on the one open 投资日报提醒 issue and mentions the owner so GitHub emails them. The first message
 * opens the issue instead, so it too arrives as a single email.
 */
export async function commentOnIssue(
  repo: string,
  token: string,
  owner: string,
  markdown: string,
  known: number | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<{ number: number; url: string }> {
  let issue: GithubIssue | undefined;
  if (known) {
    issue = await github<GithubIssue>(fetchImpl, token, `/repos/${repo}/issues/${known}`).catch(() => undefined);
    if (issue?.state !== "open") issue = undefined;
  }
  if (!issue) {
    const open = await github<GithubIssue[]>(fetchImpl, token, `/repos/${repo}/issues?state=open&per_page=100`);
    issue = open.find((i) => i.title === ISSUE_TITLE && i.user?.login === "github-actions[bot]");
  }
  if (!issue) {
    issue = await github<GithubIssue>(fetchImpl, token, `/repos/${repo}/issues`, {
      method: "POST",
      body: {
        title: ISSUE_TITLE,
        body: [
          `@${owner} 投资日报每次更新时，如果出现新的提醒或数据异常，会在这个 issue 下留言（每次更新最多一条），GitHub 会按你的通知设置发邮件。`,
          "配置了 Server酱（仓库密钥 `SERVERCHAN_SENDKEY`）之后改为推送到微信，这里不再留言。设置方法见 README 的「提醒与推送」。",
          "",
          "---",
          "",
          markdown,
        ].join("\n"),
      },
    });
    return { number: issue.number, url: issue.html_url };
  }
  await github(fetchImpl, token, `/repos/${repo}/issues/${issue.number}/comments`, { method: "POST", body: { body: `${markdown}\n\n@${owner}` } });
  return { number: issue.number, url: issue.html_url };
}
