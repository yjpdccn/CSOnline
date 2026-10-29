import { SITE } from "@/config/site";
import { ENABLED_SOURCES } from "@/config/sources";
import { readDay, readDigests, readIndex, readMeta } from "@/lib/pipeline/store";
import type { NewsItem } from "@/lib/types";
import {
  toClientItem,
  toRunInfo,
  type ClientDay,
  type ClientDigest,
  type HomeData,
  type SourceOption,
} from "@/lib/view";

export async function loadClientDay(day: string): Promise<ClientDay | null> {
  const file = await readDay(day);
  if (!file) return null;
  return { day: file.day, items: file.items.map(toClientItem) };
}

export async function loadHomeData(): Promise<HomeData> {
  const [index, meta, digests] = await Promise.all([readIndex(), readMeta(), readDigests()]);
  const initial = index.slice(0, SITE.initialDays);
  const files = (await Promise.all(initial.map((d) => readDay(d.day)))).filter((f) => f !== null);

  const loadedItems = new Map<string, NewsItem>();
  for (const file of files) for (const item of file.items) loadedItems.set(item.id, item);

  const latestDigestDay = Object.keys(digests).sort().at(-1);
  const rawDigest = latestDigestDay ? digests[latestDigestDay] : undefined;
  let digest: ClientDigest | null = null;
  if (rawDigest) {
    digest = {
      day: rawDigest.day,
      generatedAt: rawDigest.generatedAt,
      mode: rawDigest.mode,
      model: rawDigest.model,
      overview: rawDigest.overview,
      itemCount: rawDigest.itemCount,
      points: rawDigest.points.map((p) => ({
        text: p.text,
        refs: p.refs.flatMap((id) => {
          const item = loadedItems.get(id);
          if (!item) return [];
          const view = toClientItem(item);
          return [{ id, title: view.title, url: view.url, sourceName: view.sourceName }];
        }),
      })),
    };
  }

  // Sources present in history but since removed from the config still show up in the filter.
  const sources: SourceOption[] = ENABLED_SOURCES.map((s) => ({ id: s.id, name: s.name, group: s.group }));
  for (const item of loadedItems.values()) {
    if (!sources.some((s) => s.id === item.sourceId)) {
      sources.push({ id: item.sourceId, name: item.sourceName, group: item.sourceGroup });
    }
  }

  return {
    days: files.map((f) => ({ day: f.day, items: f.items.map(toClientItem) })),
    dayIndex: index,
    digest,
    lastRun: toRunInfo(meta.lastRun),
    sources,
  };
}
