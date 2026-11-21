import { describe, expect, it } from "vitest";
import { oldestFirst, pacedResult, readPaced } from "@/lib/invest/paced";
import { HttpError } from "@/lib/pipeline/http";

describe("paced reads", () => {
  it("rides out 天天基金's 514 Frequency Capped with backoff instead of losing the page", async () => {
    const calls: Record<string, number> = {};
    const pauses: number[] = [];
    const read = await readPaced(
      ["021277", "096001"],
      async (code) => {
        calls[code] = (calls[code] ?? 0) + 1;
        if (code === "021277" && calls[code] < 3) throw new HttpError("HTTP 514 Frequency Capped", 514);
        return code;
      },
      { sleep: async (ms) => void pauses.push(ms), random: () => 0.5 },
    );
    expect([...read.values.keys()].sort()).toEqual(["021277", "096001"]);
    expect(calls["021277"]).toBe(3);
    expect(pauses).toEqual([1_000, 2_000]);
    expect(pacedResult("fund-fees", "天天基金费率与申购状态", 2, read)).toMatchObject({ ok: true, count: 2, total: 2 });
  });

  it("reports what is still missing and puts the oldest read first", async () => {
    const read = await readPaced(
      ["021277"],
      async () => {
        throw new HttpError("HTTP 514 Frequency Capped", 514);
      },
      { sleep: async () => {} },
    );
    expect(pacedResult("fund-fees", "天天基金费率与申购状态", 26, read)).toMatchObject({ ok: true, count: 25, error: "021277：HTTP 514 Frequency Capped，下次运行优先重试" });
    const readAt: Record<string, string | undefined> = { "096001": "2026-11-21T03:58:00Z", "021277": "2026-11-20T19:16:00Z", "008701": undefined };
    expect(oldestFirst(Object.keys(readAt), (code) => readAt[code])).toEqual(["008701", "021277", "096001"]);
  });
});
