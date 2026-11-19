import type { HttpClient } from "./http";

export interface PacingOptions {
  /** Minimum gap between request STARTS to the same host. Default 500. */
  minIntervalMs?: number;
  /** Per-host override of the gap. */
  perHostMinIntervalMs?: Record<string, number>;
  /** Domains whose subdomains share one pacing queue, e.g. "recruitee.com" for <slug>.recruitee.com. */
  sharedHosts?: string[];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface HostState {
  lastStart: number | null;
  tail: Promise<unknown>;
}

/**
 * Pacing for real runs: 500 ms between requests to a host, 100 ms for GitHub's far more tolerant raw host.
 * Recruitee gives every company its own subdomain, so all of them share one queue.
 */
export const DEFAULT_PACING: PacingOptions = {
  minIntervalMs: 500,
  perHostMinIntervalMs: { "raw.githubusercontent.com": 100 },
  sharedHosts: ["recruitee.com"],
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

  /** The queue a host belongs to: its shared parent domain when it has one, otherwise the host itself. */
  const pacingKey = (host: string) => opts.sharedHosts?.find((d) => host === d || host.endsWith(`.${d}`)) ?? host;

  function schedule<T>(url: string, call: () => Promise<T>): Promise<T> {
    const key = pacingKey(new URL(url).host);
    let state = hosts.get(key);
    if (!state) {
      state = { lastStart: null, tail: Promise.resolve() };
      hosts.set(key, state);
    }
    const hostState = state;
    const interval = opts.perHostMinIntervalMs?.[key] ?? minIntervalMs;
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
