export const USER_AGENT = "job-searcher-mvp/0.1";

export interface HttpClient {
  getJson(url: string): Promise<unknown>;
  getText(url: string): Promise<string>;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface HttpOptions {
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Default 20000. */
  timeoutMs?: number;
  /** Default 2 (so at most 3 attempts). */
  retries?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryDelayMs(res: Response, attempt: number): number {
  if (res.status === 429) {
    const seconds = Number(res.headers.get("Retry-After"));
    if (res.headers.get("Retry-After") !== null && Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds, 30) * 1000;
    }
  }
  return 1000 * attempt;
}

export function createHttpClient(opts: HttpOptions = {}): HttpClient {
  const fetchFn = opts.fetchFn ?? globalThis.fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const timeoutMs = opts.timeoutMs ?? 20000;
  const retries = opts.retries ?? 2;

  async function request(url: string, headers: Record<string, string>): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      const canRetry = attempt <= retries;
      let res: Response;
      try {
        res = await fetchFn(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      } catch (err) {
        if (!canRetry) throw err;
        await sleep(1000 * attempt);
        continue;
      }
      if (res.ok) return res;
      const error = new HttpError(res.status, url, `HTTP ${res.status} for ${url}`);
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || !canRetry) throw error;
      await sleep(retryDelayMs(res, attempt));
    }
  }

  return {
    async getJson(url) {
      const res = await request(url, { "User-Agent": USER_AGENT, Accept: "application/json" });
      const text = await res.text();
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new Error(`Invalid JSON from ${url}`);
      }
    },
    async getText(url) {
      const res = await request(url, { "User-Agent": USER_AGENT });
      return res.text();
    },
  };
}
