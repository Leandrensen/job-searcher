import { and, asc, count, eq, gte, isNull, max, ne, or } from "drizzle-orm";
import { dedupeKey } from "@/core/dedupe";
import type { Job, SourceId } from "@/core/job";
import type { Db } from "./client";
import { fetchRuns, jobs } from "./schema";

const DUPLICATE_WINDOW_DAYS = 30;

/** Oldest job from another source that looks like the same posting, or null. */
function findOriginal(tx: Pick<Db, "select">, job: Job, key: string, nowIso: string): number | null {
  const cutoff = new Date(Date.parse(nowIso) - DUPLICATE_WINDOW_DAYS * 86_400_000).toISOString();
  const row = tx
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        ne(jobs.source, job.source),
        isNull(jobs.duplicateOf),
        gte(jobs.firstSeenAt, cutoff),
        or(eq(jobs.dedupeKey, key), job.applyUrl ? eq(jobs.applyUrl, job.applyUrl) : undefined),
      ),
    )
    .orderBy(asc(jobs.firstSeenAt), asc(jobs.id))
    .limit(1)
    .get();
  return row?.id ?? null;
}

export function upsertJobs(db: Db, items: Job[], nowIso: string): { inserted: number; updated: number } {
  return db.transaction((tx) => {
    let inserted = 0;
    let updated = 0;
    for (const job of items) {
      const key = dedupeKey(job);
      const existing = tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(eq(jobs.source, job.source), eq(jobs.externalId, job.externalId)))
        .get();
      if (existing) {
        tx.update(jobs)
          .set({ ...job, lastSeenAt: nowIso, dedupeKey: key })
          .where(eq(jobs.id, existing.id))
          .run();
        updated++;
      } else {
        tx.insert(jobs)
          .values({
            ...job,
            firstSeenAt: nowIso,
            lastSeenAt: nowIso,
            dedupeKey: key,
            duplicateOf: findOriginal(tx, job, key, nowIso),
          })
          .run();
        inserted++;
      }
    }
    return { inserted, updated };
  });
}

export function latestPostedAt(db: Db, source: SourceId): string | null {
  const row = db.select({ v: max(jobs.postedAt) }).from(jobs).where(eq(jobs.source, source)).get();
  return row?.v ?? null;
}

export function lastSuccessfulRunAt(db: Db, source: SourceId): string | null {
  const row = db
    .select({ v: max(fetchRuns.finishedAt) })
    .from(fetchRuns)
    .where(and(eq(fetchRuns.source, source), eq(fetchRuns.status, "success")))
    .get();
  return row?.v ?? null;
}

export function recordRun(db: Db, run: Omit<typeof fetchRuns.$inferInsert, "id">): void {
  db.insert(fetchRuns).values(run).run();
}

export function countJobs(db: Db, source?: SourceId): number {
  const q = db.select({ n: count() }).from(jobs);
  const row = (source ? q.where(eq(jobs.source, source)) : q).get();
  return row?.n ?? 0;
}
