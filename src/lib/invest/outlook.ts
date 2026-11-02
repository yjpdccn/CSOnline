import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * The weekly 大方向 note, written by hand (not by the free model) into content/invest-outlook/<date>.json.
 * The page shows the latest; it holds no amounts, allocation targets or personal plans.
 */
export interface OutlookSource {
  name: string;
  url: string;
}

export interface OutlookAsset {
  id: string;
  name: string;
  status: string;
  valuation: string;
  trend: string;
  drivers: { text: string; sources: OutlookSource[] }[];
  /** What it means for a long-term 定投 investor, in general terms. */
  longTerm: string;
}

export interface OutlookNote {
  date: string;
  title: string;
  summary: string;
  asOf?: string;
  assets: OutlookAsset[];
  watch: string[];
  dataSources?: OutlookSource[];
}

/** A note older than this is shown as out of date. */
export const OUTLOOK_MAX_AGE_DAYS = 10;

const DIR = path.join(process.cwd(), "content", "invest-outlook");

export async function loadLatestOutlook(): Promise<OutlookNote | null> {
  try {
    const files = (await fs.readdir(DIR)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    if (!files.length) return null;
    return JSON.parse(await fs.readFile(path.join(DIR, files.at(-1)!), "utf8")) as OutlookNote;
  } catch {
    return null;
  }
}
