import type { HttpClient } from "./http";

export interface PacingOptions {
  /** Minimum gap between request STARTS to the same host. Default 500. */
  minIntervalMs?: number;
  /** Per-host override of the gap. */
  perHostMinIntervalMs?: Record<string, number>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface HostState {
  lastStart: number | null;
  tail: Promise<unknown>;
}

/**
 * Pacing for real runs. Workable's widget API starts answering 429 at about 2 requests per second
 * (seen on 2026-11-17), so it gets one request every 10 seconds. GitHub's raw host is far more tolerant.
 */
export const DEFAULT_PACING: PacingOptions = {
  minIntervalMs: 500,
  perHostMinIntervalMs: { "raw.githubusercontent.com": 100, "apply.workable.com": 10_000 },
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Wraps any HttpClient so requests to the same host run one at a time, in call order, with a minimum gap
 * between starts. Different hosts run in parallel. Errors pass through unchanged and still count for pacing.
 */
export function createPacedHttpClient(inner: HttpClient, opts: PacingOptions = {}): HttpClient {
  const minIntervalMs = opts.minIntervalMs ?? 500;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const hosts = new Map<string, HostState>();

  function schedule<T>(url: string, call: () => Promise<T>): Promise<T> {
    const host = new URL(url).host;
    let state = hosts.get(host);
    if (!state) {
      state = { lastStart: null, tail: Promise.resolve() };
      hosts.set(host, state);
    }
    const hostState = state;
    const interval = opts.perHostMinIntervalMs?.[host] ?? minIntervalMs;
    const run = hostState.tail.then(async () => {
      if (hostState.lastStart !== null) {
        const wait = hostState.lastStart + interval - now();
        if (wait > 0) await sleep(wait);
      }
      hostState.lastStart = now();
      return call();
    });
    hostState.tail = run.catch(() => undefined);
    return run;
  }

  return {
    getJson: (url) => schedule(url, () => inner.getJson(url)),
    getText: (url) => schedule(url, () => inner.getText(url)),
  };
}
