import { and, asc, count, eq, gte, inArray, isNotNull, isNull, lte, max, ne, notInArray, or } from "drizzle-orm";
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

export function upsertJobs(
  db: Db,
  items: Job[],
  nowIso: string,
  opts: { companyId?: number } = {},
): { inserted: number; updated: number } {
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
          // A job that appears again is open again.
          .set({
            ...job,
            lastSeenAt: nowIso,
            dedupeKey: key,
            closedAt: null,
            ...(opts.companyId !== undefined ? { companyId: opts.companyId } : {}),
          })
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
            companyId: opts.companyId ?? null,
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

/** Marks a company's open jobs that are missing from its latest full list as closed. Returns how many were closed. */
export function markClosedJobs(db: Db, companyId: number, seenExternalIds: string[], nowIso: string): number {
  const unseen = seenExternalIds.length > 0 ? notInArray(jobs.externalId, seenExternalIds) : undefined;
  return db
    .update(jobs)
    .set({ closedAt: nowIso })
    .where(and(eq(jobs.companyId, companyId), isNull(jobs.closedAt), unseen))
    .run().changes;
}

/** Deletes jobs closed more than `days` (default 30) days ago. Returns how many were deleted. */
export function purgeClosedJobs(db: Db, nowIso: string, days = 30): number {
  const cutoff = new Date(Date.parse(nowIso) - days * 86_400_000).toISOString();
  const expired = and(isNotNull(jobs.closedAt), lte(jobs.closedAt, cutoff));
  return db.transaction((tx) => {
    const expiredIds = tx.select({ id: jobs.id }).from(jobs).where(expired);
    tx.update(jobs).set({ duplicateOf: null }).where(inArray(jobs.duplicateOf, expiredIds)).run();
    return tx.delete(jobs).where(expired).run().changes;
  });
}

export function countJobs(db: Db, optsOrSource: SourceId | { source?: SourceId; openOnly?: boolean } = {}): number {
  const opts = typeof optsOrSource === "string" ? { source: optsOrSource } : optsOrSource;
  const where = and(opts.source ? eq(jobs.source, opts.source) : undefined, opts.openOnly ? isNull(jobs.closedAt) : undefined);
  return db.select({ n: count() }).from(jobs).where(where).get()?.n ?? 0;
}
