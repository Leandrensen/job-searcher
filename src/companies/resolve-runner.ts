import type { AtsId } from "@/core/job";
import type { HttpClient } from "@/core/http";
import type { Db } from "@/db/client";
import { listDueCandidates, recordResolution } from "@/db/companies";
import { resolveCandidate } from "./resolve";
import type { ProbeFn, Resolution } from "./types";

export type ResolutionStats = {
  checked: number;
  confirmed: number;
  ambiguous: number;
  notFound: number;
  errors: number;
  byOrigin: Record<string, { checked: number; confirmed: number }>;
};

export interface ResolveDueOptions {
  db: Db;
  /** Pass a paced client: this function doesn't add pacing of its own. */
  http: HttpClient;
  probes: Record<AtsId, ProbeFn>;
  now: () => Date;
  limit?: number;
  /** Default 6. */
  concurrency?: number;
  log?: (msg: string) => void;
  /** Injected for tests. Defaults to the real resolver. */
  resolve?: typeof resolveCandidate;
}

const PROGRESS_EVERY = 25;

/** Resolve every due candidate and write each result as soon as it is known, so an interrupted run resumes. Never rejects. */
export async function resolveDueCandidates(opts: ResolveDueOptions): Promise<ResolutionStats> {
  const { db, http, probes } = opts;
  const resolve = opts.resolve ?? resolveCandidate;
  const log = opts.log ?? (() => {});
  const concurrency = Math.max(1, opts.concurrency ?? 6);
  const nowIso = opts.now().toISOString();
  const due = listDueCandidates(db, nowIso, opts.limit);

  const stats: ResolutionStats = { checked: 0, confirmed: 0, ambiguous: 0, notFound: 0, errors: 0, byOrigin: {} };

  function record(origin: string, name: string, candidateId: number, result: Resolution) {
    try {
      recordResolution(db, candidateId, result, nowIso);
    } catch (err) {
      log(`resolve: could not record ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
    stats.checked++;
    const origins = (stats.byOrigin[origin] ??= { checked: 0, confirmed: 0 });
    origins.checked++;
    if (result.status === "confirmed") {
      stats.confirmed++;
      origins.confirmed++;
    } else if (result.status === "ambiguous") stats.ambiguous++;
    else if (result.status === "not_found") stats.notFound++;
    else stats.errors++;
    if (stats.checked % PROGRESS_EVERY === 0) {
      log(
        `resolve: ${stats.checked}/${due.length} (confirmed ${stats.confirmed}, ambiguous ${stats.ambiguous}, not found ${stats.notFound}, errors ${stats.errors})`,
      );
    }
  }

  let next = 0;
  async function worker(): Promise<void> {
    while (next < due.length) {
      const candidate = due[next++]!;
      let result: Resolution;
      try {
        result = await resolve(
          http,
          { name: candidate.name, website: candidate.website, careersUrl: candidate.careersUrl, atsHints: candidate.atsHints },
          probes,
        );
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        result = { status: "error", error: `${e.name}: ${e.message}` };
      }
      record(candidate.origin, candidate.name, candidate.id, result);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, due.length) }, worker));
  return stats;
}
