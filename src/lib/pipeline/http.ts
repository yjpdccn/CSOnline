export const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface FetchOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  retries?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function decode(buffer: ArrayBuffer, contentType: string | null): string {
  const bytes = new Uint8Array(buffer);
  let charset = contentType?.match(/charset=([\w-]+)/i)?.[1]?.toLowerCase();
  if (!charset) {
    const head = new TextDecoder("latin1").decode(bytes.slice(0, 512));
    charset = head.match(/encoding=["']([\w-]+)["']/i)?.[1]?.toLowerCase() ?? head.match(/charset=["']?([\w-]+)/i)?.[1]?.toLowerCase();
  }
  if (charset && charset !== "utf-8" && charset !== "utf8") {
    try {
      return new TextDecoder(charset).decode(bytes);
    } catch {
      // Unknown label: fall back to UTF-8.
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const { method = "GET", headers = {}, body, timeoutMs = 20_000, retries = 1 } = opts;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        body,
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "User-Agent": BROWSER_UA,
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          ...headers,
        },
      });
      if (!res.ok) {
        const err = new HttpError(`HTTP ${res.status} ${res.statusText}`.trim(), res.status);
        if (res.status === 429 || res.status >= 500) {
          lastError = err;
          if (attempt < retries) await sleep(1500 * (attempt + 1));
          continue;
        }
        throw err;
      }
      return decode(await res.arrayBuffer(), res.headers.get("content-type"));
    } catch (err) {
      if (err instanceof HttpError && err.status < 500 && err.status !== 429) throw err;
      lastError = err;
      if (attempt < retries) await sleep(1500 * (attempt + 1));
    }
  }
  throw normalizeError(lastError);
}

export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const text = await fetchText(url, {
    ...opts,
    headers: { Accept: "application/json", ...opts.headers },
  });
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`返回内容不是 JSON：${text.slice(0, 80)}`);
  }
}

export function normalizeError(err: unknown): Error {
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") return new Error("请求超时");
    const cause = (err as { cause?: { code?: string } }).cause;
    if (cause?.code) return new Error(`网络错误（${cause.code}）`);
    return err;
  }
  return new Error(String(err));
}
