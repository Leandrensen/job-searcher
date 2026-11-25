import { and, asc, eq, gte, inArray, isNotNull, isNull, ne, or, type SQL } from "drizzle-orm";
import { addDays } from "@/core/dates";
import type { Db } from "./client";
import { jobs } from "./schema";

/** Only jobs last seen this many days before a new job was first seen can share its posting group. findOriginal uses the same window. */
export const GROUP_WINDOW_DAYS = 30;

export type GroupInput = {
  id: number;
  source: string;
  dedupeKey: string;
  applyUrl: string | null;
  descriptionText: string;
  companyId: number | null;
  firstSeenAt: string;
};

type Tx = Pick<Db, "select" | "update">;

function distinctGroups(tx: Tx, where: SQL | undefined): number[] {
  const rows = tx.select({ groupId: jobs.groupId }).from(jobs).where(where).groupBy(jobs.groupId).all();
  return rows.map((r) => r.groupId).filter((g): g is number => g !== null);
}

/** Links that prove two jobs are the same posting: a shared apply URL, or the same description on the same board or company. */
function strongMatch(job: GroupInput): SQL | undefined {
  const links: SQL[] = [];
  if (job.applyUrl !== null) links.push(eq(jobs.applyUrl, job.applyUrl));
  if (job.descriptionText !== "") {
    links.push(and(eq(jobs.source, job.source), eq(jobs.dedupeKey, job.dedupeKey), eq(jobs.descriptionText, job.descriptionText))!);
    if (job.companyId !== null) {
      // Location variants: one company board posting the same opening under different titles.
      links.push(and(eq(jobs.companyId, job.companyId), eq(jobs.descriptionText, job.descriptionText))!);
    }
  }
  return links.length > 0 ? or(...links) : undefined;
}

/** Decides the posting group of one job, sets its group_id (merging groups it strongly links) and returns the group id. */
export function assignGroup(tx: Tx, job: GroupInput): number {
  const cutoff = addDays(job.firstSeenAt, -GROUP_WINDOW_DAYS);
  // Only grouped rows count, so an id-order backfill follows the same order as insert-time grouping. It reads the
  // rows' current values, though, so a job changed since it was stored can land in a different group than it would have then.
  const live = and(isNotNull(jobs.groupId), ne(jobs.id, job.id), gte(jobs.lastSeenAt, cutoff));

  const strong = strongMatch(job);
  const strongGroups = strong ? distinctGroups(tx, and(live, strong)) : [];
  let target: number;
  if (strongGroups.length > 0) {
    target = Math.min(...strongGroups);
    const merged = strongGroups.filter((g) => g !== target);
    if (merged.length > 0) tx.update(jobs).set({ groupId: target }).where(inArray(jobs.groupId, merged)).run();
  } else {
    const weakGroups = distinctGroups(tx, and(live, eq(jobs.dedupeKey, job.dedupeKey), ne(jobs.source, job.source)));
    // A group that already has a job from this board (of any age) is a different opening there,
    // or this job would have matched it strongly.
    const taken = weakGroups.length > 0 ? distinctGroups(tx, and(inArray(jobs.groupId, weakGroups), eq(jobs.source, job.source))) : [];
    const open = weakGroups.filter((g) => !taken.includes(g));
    target = open.length > 0 ? Math.min(...open) : job.id;
  }
  tx.update(jobs).set({ groupId: target }).where(eq(jobs.id, job.id)).run();
  return target;
}

/** Groups every job whose group_id is null, in id order. Returns how many jobs it grouped. */
export function ensureJobGroups(db: Db): number {
  return db.transaction((tx) => {
    const ungrouped = tx
      .select({
        id: jobs.id,
        source: jobs.source,
        dedupeKey: jobs.dedupeKey,
        applyUrl: jobs.applyUrl,
        descriptionText: jobs.descriptionText,
        companyId: jobs.companyId,
        firstSeenAt: jobs.firstSeenAt,
      })
      .from(jobs)
      .where(isNull(jobs.groupId))
      .orderBy(asc(jobs.id))
      .all();
    for (const job of ungrouped) assignGroup(tx, job);
    return ungrouped.length;
  });
}
