import { Agent, setGlobalDispatcher } from "undici";

/**
 * Connection settings for every fetch in the process: the shared HTTP helper, the LLM client and the push
 * notifications (Node's built-in fetch uses undici's global dispatcher too). GitHub's runners have no IPv6 and
 * a slow, lossy path to servers in China. Node's defaults give each address of a host 250 ms and the whole
 * connection 10 s: a host that also lists IPv6 loses its IPv4 attempt, and a host that lists several addresses
 * runs out of time before trying them all.
 */
setGlobalDispatcher(new Agent({ connect: { timeout: 15_000, autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 2_500 } }));

const CONNECT_CODES = new Set(["UND_ERR_CONNECT_TIMEOUT", "ETIMEDOUT", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "EAI_AGAIN", "ENOTFOUND"]);

/** The request failed before anything was sent (DNS or connection), so retrying cannot send it twice. */
export function failedToConnect(err: unknown): boolean {
  const code = (err as { cause?: { code?: string } } | undefined)?.cause?.code;
  return code !== undefined && CONNECT_CODES.has(code);
}

/** Retries a request, POSTs included, while it fails to connect: pauses of about 1 s, then 2 s, jittered. */
export async function retryConnect<T>(send: () => Promise<T>, attempts = 3, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))): Promise<T> {
  for (let k = 0; ; k++) {
    try {
      return await send();
    } catch (err) {
      if (k >= attempts - 1 || !failedToConnect(err)) throw err;
      await sleep(1_000 * 2 ** k * (0.5 + Math.random()));
    }
  }
}
