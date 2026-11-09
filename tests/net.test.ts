import { describe, expect, it } from "vitest";
import { failedToConnect, retryConnect } from "@/lib/pipeline/net";

const failure = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: { code } });

describe("connection retries", () => {
  it("tells failures to connect from failures after the request went out", () => {
    expect(failedToConnect(failure("UND_ERR_CONNECT_TIMEOUT"))).toBe(true);
    expect(failedToConnect(failure("ETIMEDOUT"))).toBe(true);
    expect(failedToConnect(failure("ECONNRESET"))).toBe(false);
    expect(failedToConnect(new Error("Server酱返回 500"))).toBe(false);
  });

  it("retries a request that failed to connect, with growing pauses, and gives up after three attempts", async () => {
    const pauses: number[] = [];
    const sleep = async (ms: number) => void pauses.push(ms);
    let calls = 0;
    await expect(
      retryConnect(
        async () => {
          calls++;
          if (calls < 3) throw failure("UND_ERR_CONNECT_TIMEOUT");
          return "sent";
        },
        3,
        sleep,
      ),
    ).resolves.toBe("sent");
    expect(calls).toBe(3);
    expect(pauses).toHaveLength(2);
    expect(pauses[0]).toBeGreaterThanOrEqual(500);
    expect(pauses[1]).toBeGreaterThanOrEqual(1_000);

    calls = 0;
    await expect(retryConnect(async () => (calls++, Promise.reject(failure("ENETUNREACH"))), 3, sleep)).rejects.toThrow("fetch failed");
    expect(calls).toBe(3);
  });

  it("does not resend a request that may have reached the server", async () => {
    let calls = 0;
    await expect(retryConnect(async () => (calls++, Promise.reject(failure("ECONNRESET"))), 3, async () => {})).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
