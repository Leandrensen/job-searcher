import { and, count, eq, max } from "drizzle-orm";
import { dedupeKey } from "@/core/dedupe";
import type { Job, SourceId } from "@/core/job";
import type { Db } from "./client";
import { fetchRuns, jobs } from "./schema";

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
          .values({ ...job, firstSeenAt: nowIso, lastSeenAt: nowIso, dedupeKey: key })
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
