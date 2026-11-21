import { errorMessage } from "@/core/errors";
import type { HttpClient } from "@/core/http";
import type { Db } from "@/db/client";
import { recordCandidatesFromBoardJobs } from "@/companies/discover";
import { BOARD_IDS, type BoardId } from "@/core/job";
import { lastSuccessfulRunAt, latestPostedAt, recordRun } from "@/db/queries";
import { runAdapter } from "./run-adapter";
import type { AnyAdapter, FetchResult } from "./types";

export interface BoardRunSummary extends Omit<FetchResult, "jobs"> {
  inserted: number;
  updated: number;
}

export interface RunBoardSourcesOptions {
  db: Db;
  http: HttpClient;
  adapters: AnyAdapter[];
  force?: boolean;
  now?: () => Date;
  log?: (msg: string) => void;
}

const MAX_CONCURRENCY = 4;

export async function runBoardSources(opts: RunBoardSourcesOptions): Promise<BoardRunSummary[]> {
  const { db, http, adapters, force = false } = opts;
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? (() => {});

  /** Runs one source. Never throws: unexpected failures (e.g. a DB error) become an `error` summary. */
  async function runOne(adapter: AnyAdapter): Promise<BoardRunSummary> {
    const startedAt = now();
    const startMs = Date.now();
    let counts = { fetched: 0, invalid: 0, filtered: 0 };
    try {
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
            latestPostedAt: null,
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
      counts = { fetched: result.fetched, invalid: result.invalid, filtered: result.filtered };
      // Boards store no jobs: their postings only become company candidates.
      if (!(BOARD_IDS as readonly string[]).includes(adapter.id)) throw new Error(`runBoardSources only runs board adapters (got ${adapter.id})`);
      const { inserted, updated } =
        result.status === "success"
          ? recordCandidatesFromBoardJobs(db, adapter.id as BoardId, jobs, startedAt.toISOString())
          : { inserted: 0, updated: 0 };
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
        latestPostedAt: result.latestPostedAt,
        error: result.error,
      });
      return { ...result, inserted, updated };
    } catch (err) {
      const message = errorMessage(err);
      log(`${adapter.id}: ${message}`);
      try {
        recordRun(db, {
          source: adapter.id,
          startedAt: startedAt.toISOString(),
          finishedAt: now().toISOString(),
          status: "error",
          ...counts,
          error: message,
        });
      } catch (recordErr) {
        log(`${adapter.id}: could not record run: ${errorMessage(recordErr)}`);
      }
      return {
        source: adapter.id,
        status: "error",
        ...counts,
        latestPostedAt: null,
        error: message,
        durationMs: Date.now() - startMs,
        inserted: 0,
        updated: 0,
      };
    }
  }

  const results: BoardRunSummary[] = new Array(adapters.length);
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
