import path from "node:path";
import { dataDir, readJson, writeJson } from "@/lib/pipeline/store";
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
}

const EMPTY_TIME = "";

export async function loadInvestStore(): Promise<InvestStore> {
  const [market, funds, news, calendar, alerts, overview, meta] = await Promise.all([
    readJson<MarketFile>(file("market"), { updatedAt: EMPTY_TIME, series: {}, valuations: {} }),
    readJson<FundsFile>(file("funds"), { updatedAt: EMPTY_TIME, funds: {} }),
    readJson<NewsFile>(file("news"), { updatedAt: EMPTY_TIME, items: [] }),
    readJson<CalendarFile>(file("calendar"), { updatedAt: EMPTY_TIME, events: [], fomc: [] }),
    readJson<AlertsFile | null>(file("alerts"), null),
    readJson<OverviewFile | null>(file("overview"), null),
    readJson<InvestMetaFile>(file("meta"), { history: [] }),
  ]);
  return { market, funds, news, calendar, alerts, overview, meta };
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
  await writeJson(file("meta"), store.meta);
}
