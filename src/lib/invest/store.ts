import path from "node:path";
import { dataDir, readJson, writeJson } from "@/lib/pipeline/store";
import type { NotifyFile } from "./notify";
import type { StatusFile } from "./status";
import { emptyStrategy, type StrategyFile } from "./strategy";
import type { AlertsFile, CalendarFile, FundsFile, InvestMetaFile, MarketFile, NewsFile, OverviewFile } from "./types";

const file = (name: string) => path.join(dataDir(), "invest", `${name}.json`);

export interface InvestStore {
  market: MarketFile;
  funds: FundsFile;
  news: NewsFile;
  calendar: CalendarFile;
  alerts: AlertsFile | null;
  overview: OverviewFile | null;
  meta: InvestMetaFile;
  /** Published as /invest/status.json. */
  status: StatusFile | null;
  notify: NotifyFile;
  strategy: StrategyFile;
}

const EMPTY_TIME = "";

export const readInvestStatus = () => readJson<StatusFile | null>(file("status"), null);

export async function loadInvestStore(): Promise<InvestStore> {
  const [market, funds, news, calendar, alerts, overview, meta, status, notify, strategy] = await Promise.all([
    readJson<MarketFile>(file("market"), { updatedAt: EMPTY_TIME, series: {}, valuations: {} }),
    readJson<FundsFile>(file("funds"), { updatedAt: EMPTY_TIME, funds: {} }),
    readJson<NewsFile>(file("news"), { updatedAt: EMPTY_TIME, items: [] }),
    readJson<CalendarFile>(file("calendar"), { updatedAt: EMPTY_TIME, events: [], fomc: [] }),
    readJson<AlertsFile | null>(file("alerts"), null),
    readJson<OverviewFile | null>(file("overview"), null),
    readJson<InvestMetaFile>(file("meta"), { history: [] }),
    readInvestStatus(),
    readJson<NotifyFile>(file("notify"), { sent: {} }),
    readJson<StrategyFile>(file("strategy"), emptyStrategy()),
  ]);
  return { market, funds, news, calendar, alerts, overview, meta, status, notify, strategy };
}

const HISTORY_LENGTH = 60;

export async function saveInvestStore(store: InvestStore): Promise<void> {
  store.meta.history = store.meta.history.slice(0, HISTORY_LENGTH);
  await writeJson(file("market"), store.market);
  await writeJson(file("funds"), store.funds);
  await writeJson(file("news"), store.news);
  await writeJson(file("calendar"), store.calendar);
  if (store.alerts) await writeJson(file("alerts"), store.alerts);
  if (store.overview) await writeJson(file("overview"), store.overview);
  if (store.status) await writeJson(file("status"), store.status);
  await writeJson(file("notify"), store.notify);
  await writeJson(file("strategy"), store.strategy);
  await writeJson(file("meta"), store.meta);
}
