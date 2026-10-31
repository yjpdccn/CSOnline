import type { Observation } from "./observations";
import type { DataIssue, NotifyOutcome } from "./types";

/** What was already told, so each run only sends what is new or changed. Public: keys and short labels only. */
export interface NotifyFile {
  sent: Record<string, { hash: string; label: string }>;
  issueNumber?: number;
  lastSentAt?: string;
  channel?: NotifyChannel;
  lastError?: string;
}

export type NotifyChannel = NonNullable<NotifyOutcome["channel"]>;

export const ISSUE_TITLE = "投资日报提醒";

const issueHash = (i: DataIssue) => `${i.kind}:${[...i.items].sort().join(",")}`;

export interface NotifyDiff {
  issues: DataIssue[];
  resolved: string[];
  alerts: Observation[];
  next: NotifyFile["sent"];
  /** Nothing was sent before: the message lists everything there is. */
  first: boolean;
}

/** New or changed problems and alerts since the last message; minor data issues (one news source) are left out. */
export function diffNotifications(sent: NotifyFile["sent"], issues: DataIssue[], alerts: Observation[]): NotifyDiff {
  const next: NotifyFile["sent"] = {};
  const fresh: NotifyDiff = { issues: [], resolved: [], alerts: [], next, first: Object.keys(sent).length === 0 };
  for (const issue of issues.filter((i) => i.severity === "warn")) {
    const key = `issue:${issue.key}`;
    const hash = issueHash(issue);
    next[key] = { hash, label: issue.message.split("：")[0] };
    if (sent[key]?.hash !== hash) fresh.issues.push(issue);
  }
  for (const [key, entry] of Object.entries(sent)) {
    if (key.startsWith("issue:") && !next[key]) fresh.resolved.push(entry.label);
  }
  for (const alert of alerts) {
    const key = `alert:${alert.key}`;
    next[key] = { hash: alert.key, label: alert.title };
    if (!sent[key]) fresh.alerts.push(alert);
  }
  return fresh;
}

const MAX_LINES = 15;
const ICON = { bad: "❗", warn: "⚠️", good: "✅", info: "ℹ️" } as const;
const SEVERITY_ORDER = { bad: 0, warn: 1, good: 2, info: 3 } as const;
const KIND_ORDER = { change: 0, reminder: 1, rule: 2 } as const;

export function formatMessage(diff: NotifyDiff, pageUrl: string): { title: string; markdown: string } | null {
  const { issues, resolved } = diff;
  const alerts = [...diff.alerts].sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (a.rule ?? 0) - (b.rule ?? 0),
  );
  if (!issues.length && !resolved.length && !alerts.length) return null;
  const lines: string[] = [];
  if (diff.first) lines.push("第一次检查，下面是目前全部的提醒；以后只发新出现或有变化的内容。", "");
  if (issues.length) {
    lines.push("**数据异常**", "", ...issues.map((i) => `- ${i.message}`), "");
  }
  if (resolved.length) {
    lines.push("**数据已恢复**", "", ...resolved.map((r) => `- ${r}`), "");
  }
  if (alerts.length) {
    lines.push("**新提醒**", "");
    for (const a of alerts.slice(0, MAX_LINES)) lines.push(`- ${ICON[a.severity]} ${a.title}：${a.detail}`);
    if (alerts.length > MAX_LINES) lines.push(`- 另有 ${alerts.length - MAX_LINES} 条，见页面`);
    lines.push("");
  }
  lines.push(`[打开投资日报](${pageUrl}) · [status.json](${pageUrl}status.json)`);
  const parts = [alerts.length && `${alerts.length} 条新提醒`, issues.length && `${issues.length} 项数据异常`, !issues.length && resolved.length && "数据已恢复"].filter(Boolean);
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
