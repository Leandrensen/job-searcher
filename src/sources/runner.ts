import type { HttpClient } from "@/core/http";
import type { Db } from "@/db/client";
import { lastSuccessfulRunAt, latestPostedAt, recordRun, upsertJobs } from "@/db/queries";
import { runAdapter } from "./run-adapter";
import type { AnyAdapter, FetchResult } from "./types";

export interface SourceRunSummary extends Omit<FetchResult, "jobs"> {
  inserted: number;
  updated: number;
}

export interface RunSourcesOptions {
  db: Db;
  http: HttpClient;
  adapters: AnyAdapter[];
  force?: boolean;
  now?: () => Date;
  log?: (msg: string) => void;
}

const MAX_CONCURRENCY = 4;

export async function runSources(opts: RunSourcesOptions): Promise<SourceRunSummary[]> {
  const { db, http, adapters, force = false } = opts;
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? (() => {});

  async function runOne(adapter: AnyAdapter): Promise<SourceRunSummary> {
    const startedAt = now();
    const last = lastSuccessfulRunAt(db, adapter.id);
    if (!force && last) {
      const minutesAgo = (startedAt.getTime() - Date.parse(last)) / 60_000;
      if (minutesAgo < adapter.minIntervalMinutes) {
        log(`${adapter.id}: skipped (last run ${Math.round(minutesAgo)} min ago)`);
        recordRun(db, {
          source: adapter.id,
          startedAt: startedAt.toISOString(),
          finishedAt: startedAt.toISOString(),
          status: "skipped",
        });
        return {
          source: adapter.id,
          status: "skipped",
          fetched: 0,
          invalid: 0,
          filtered: 0,
          error: null,
          durationMs: 0,
          inserted: 0,
          updated: 0,
        };
      }
    }

    const { jobs, ...result } = await runAdapter(adapter, {
      http,
      latestPostedAt: latestPostedAt(db, adapter.id),
      log,
    });
    const { inserted, updated } =
      result.status === "success" ? upsertJobs(db, jobs, startedAt.toISOString()) : { inserted: 0, updated: 0 };
    if (result.status === "error") log(`${adapter.id}: ${result.error}`);

    recordRun(db, {
      source: adapter.id,
      startedAt: startedAt.toISOString(),
      finishedAt: now().toISOString(),
      status: result.status,
      fetched: result.fetched,
      inserted,
      updated,
      invalid: result.invalid,
      filtered: result.filtered,
      error: result.error,
    });
    return { ...result, inserted, updated };
  }

  const results: SourceRunSummary[] = new Array(adapters.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < adapters.length) {
      const i = next++;
      const adapter = adapters[i];
      if (adapter) results[i] = await runOne(adapter);
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, adapters.length) }, worker));
  return results;
}
