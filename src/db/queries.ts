import { and, asc, count, eq, gte, isNotNull, isNull, lte, max, ne, notInArray, or } from "drizzle-orm";
import { dedupeKey } from "@/core/dedupe";
import { BOARD_IDS, type Job, type SourceId } from "@/core/job";
import type { Db } from "./client";
import { assignGroup } from "./groups";
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
        // A closed job can't be the surviving copy of anything.
        isNull(jobs.closedAt),
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
  // Board jobs only feed company discovery. Letting one in would silently bring back the board-job store.
  const board = items.find((j) => (BOARD_IDS as readonly string[]).includes(j.source));
  if (board) throw new Error(`upsertJobs: board jobs are not stored (${board.source})`);
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
        const companyId = opts.companyId ?? null;
        const { id } = tx
          .insert(jobs)
          .values({
            ...job,
            firstSeenAt: nowIso,
            lastSeenAt: nowIso,
            dedupeKey: key,
            duplicateOf: findOriginal(tx, job, key, nowIso),
            companyId,
          })
          .returning({ id: jobs.id })
          .get();
        // The posting group is decided once, here; updates above keep it.
        assignGroup(tx, { id, source: job.source, dedupeKey: key, applyUrl: job.applyUrl, descriptionText: job.descriptionText, companyId, firstSeenAt: nowIso });
        inserted++;
      }
    }
    return { inserted, updated };
  });
}

/**
 * Newest posting date already seen for a source. ATS jobs are stored, so it comes from `jobs`;
 * boards store no jobs, so it comes from the runs that recorded it.
 */
export function latestPostedAt(db: Db, source: SourceId): string | null {
  if ((BOARD_IDS as readonly string[]).includes(source)) {
    const row = db
      .select({ v: max(fetchRuns.latestPostedAt) })
      .from(fetchRuns)
      .where(and(eq(fetchRuns.source, source), eq(fetchRuns.status, "success")))
      .get();
    return row?.v ?? null;
  }
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

/**
 * Drops the descriptions of jobs closed at least `days` (default 30) days ago, keeping the row. A reposted job then
 * reuses its row (and its embedding and score), so it is never embedded or scored twice. Returns how many rows changed.
 */
export function compactClosedJobs(db: Db, nowIso: string, days = 30): number {
  const cutoff = new Date(Date.parse(nowIso) - days * 86_400_000).toISOString();
  return db
    .update(jobs)
    .set({ descriptionHtml: "", descriptionText: "" })
    .where(and(isNotNull(jobs.closedAt), lte(jobs.closedAt, cutoff), or(ne(jobs.descriptionHtml, ""), ne(jobs.descriptionText, ""))))
    .run().changes;
}

export function countJobs(db: Db, optsOrSource: SourceId | { source?: SourceId; openOnly?: boolean } = {}): number {
  const opts = typeof optsOrSource === "string" ? { source: optsOrSource } : optsOrSource;
  const where = and(opts.source ? eq(jobs.source, opts.source) : undefined, opts.openOnly ? isNull(jobs.closedAt) : undefined);
  return db.select({ n: count() }).from(jobs).where(where).get()?.n ?? 0;
}
