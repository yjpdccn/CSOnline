import { commentOnIssue, diffNotifications, formatMessage, sendServerChan, type NotifyChannel, type NotifyFile } from "./notify";
import type { Observation } from "./observations";
import type { DataIssue, HealthFile, HealthGroup, HealthGroupId, NotifyOutcome } from "./types";

export interface StatusNotifications {
  /** Where the next message goes: WeChat via Server酱 when its key is set, otherwise the GitHub issue. */
  channel: NotifyChannel | "none";
  lastSentAt: string | null;
  issueUrl: string | null;
  lastError?: string;
}

/** Published at /invest/status.json: data health per group, current data issues and alerts with firstSeen. */
export interface StatusFile {
  version: 1;
  generatedAt: string;
  /** First check: what it found was already there, so firstSeen equal to this is not news. */
  since: string;
  page: string;
  /** No data issue that affects the numbers on the page. */
  ok: boolean;
  groups: Record<HealthGroupId, HealthGroup>;
  dataIssues: (DataIssue & { firstSeen: string })[];
  alerts: (Observation & { firstSeen: string })[];
  notifications: StatusNotifications;
}

export function pageUrl(): string {
  const repo = process.env.GITHUB_REPOSITORY;
  const [owner, name] = repo?.split("/") ?? [];
  return owner && name ? `https://${owner.toLowerCase()}.github.io/${name}/invest/` : "https://yjpdccn.github.io/CSOnline/invest/";
}

export function buildStatus(health: HealthFile, alerts: Observation[], previous: StatusFile | null, notifications: StatusNotifications, now: Date): StatusFile {
  const at = now.toISOString();
  const seen = new Map<string, string>([
    ...(previous?.dataIssues ?? []).map((i) => [`issue:${i.key}`, i.firstSeen] as const),
    ...(previous?.alerts ?? []).map((a) => [`alert:${a.key}`, a.firstSeen] as const),
  ]);
  return {
    version: 1,
    generatedAt: at,
    since: previous?.since ?? at,
    page: pageUrl(),
    ok: !health.issues.some((i) => i.severity === "warn"),
    groups: health.groups,
    dataIssues: health.issues.map((i) => ({ ...i, firstSeen: seen.get(`issue:${i.key}`) ?? at })),
    // Changes keep the time they were seen; standing observations count from their first run.
    alerts: alerts.map((a) => ({ ...a, firstSeen: seen.get(`alert:${a.key}`) ?? a.at ?? at })),
    notifications,
  };
}

export interface NotifyOptions {
  /** Send only from GitHub Actions or when INVEST_NOTIFY=1, so local runs never message anyone. */
  enabled: boolean;
  serverChanKey?: string;
  repo?: string;
  token?: string;
  owner?: string;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
}

/** At most one message per run, with only what is new or changed since the last one. */
export async function runNotifications(
  state: NotifyFile,
  issues: DataIssue[],
  alerts: Observation[],
  opts: NotifyOptions,
  now: Date,
): Promise<{ state: NotifyFile; summary: StatusNotifications; outcome: NotifyOutcome }> {
  const channel: NotifyChannel | "none" = opts.serverChanKey ? "serverchan" : opts.repo && opts.token ? "github-issue" : "none";
  const done = (s: NotifyFile, outcome: NotifyOutcome) => ({
    state: s,
    summary: {
      channel,
      lastSentAt: s.lastSentAt ?? null,
      issueUrl: s.issueNumber && opts.repo ? `https://github.com/${opts.repo}/issues/${s.issueNumber}` : null,
      ...(s.lastError ? { lastError: s.lastError } : {}),
    },
    outcome,
  });

  const diff = diffNotifications(state.sent, issues, alerts);
  const message = formatMessage(diff, pageUrl());
  // Nothing new: forget what went away, so it counts as new if it comes back.
  if (!message) return done({ ...state, sent: diff.next }, { result: "nothing-new" });
  if (!opts.enabled || channel === "none") {
    opts.log?.(opts.enabled ? "有新提醒，但没有配置通知渠道" : "有新提醒，本地运行不发送通知");
    return done(state, { result: "skipped", title: message.title });
  }

  const next: NotifyFile = { ...state };
  delete next.lastError;
  const toIssue = async (): Promise<NotifyChannel> => {
    const issue = await commentOnIssue(opts.repo!, opts.token!, opts.owner ?? opts.repo!.split("/")[0], message.markdown, state.issueNumber, opts.fetchImpl);
    next.issueNumber = issue.number;
    return "github-issue";
  };
  try {
    let used: NotifyChannel;
    if (opts.serverChanKey) {
      try {
        await sendServerChan(opts.serverChanKey, message.title, message.markdown, opts.fetchImpl);
        used = "serverchan";
      } catch (err) {
        // WeChat failed: the GitHub issue still reaches the owner by email.
        if (!opts.repo || !opts.token) throw err;
        next.lastError = `${now.toISOString()} 微信推送失败，改为在 GitHub issue 留言：${(err as Error).message}`;
        opts.log?.(next.lastError);
        used = await toIssue();
      }
    } else {
      used = await toIssue();
    }
    next.channel = used;
    next.sent = diff.next;
    next.lastSentAt = now.toISOString();
    opts.log?.(`已发送通知（${used === "serverchan" ? "微信" : "GitHub issue"}）：${message.title}`);
    return done(next, { result: "sent", channel: used, title: message.title });
  } catch (err) {
    // Not marked as sent: the next run tries again.
    const error = (err as Error).message;
    next.lastError = `${now.toISOString()} ${error}`;
    opts.log?.(`通知发送失败：${error}`);
    return done(next, { result: "failed", title: message.title, error });
  }
}
