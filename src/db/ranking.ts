import { asc, inArray, isNull } from "drizzle-orm";
import type { Db } from "./client";
import { jobEmbeddings, jobs } from "./schema";

export type RankableJob = {
  id: number;
  title: string;
  company: string;
  location: string | null;
  url: string;
  departments: string[];
  tags: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  descriptionText: string;
};

export type StoredEmbedding = { model: string; textHash: string; vector: Float32Array };

/**
 * Open jobs to rank, in id order, one per posting. Jobs are the same posting when they share a duplicate family or an
 * apply URL, or the same company and title (from another source, or from the same source with the same description).
 * The lowest id is ranked. Jobs failing `keep` are left out before grouping, so a passing copy still stands for its
 * posting.
 */
export function listOpenJobsForRanking(db: Db, keep: (job: RankableJob) => boolean = () => true): RankableJob[] {
  const rows = db
    .select({
      id: jobs.id,
      title: jobs.title,
      company: jobs.company,
      location: jobs.location,
      url: jobs.url,
      departments: jobs.departments,
      tags: jobs.tags,
      salaryMin: jobs.salaryMin,
      salaryMax: jobs.salaryMax,
      salaryCurrency: jobs.salaryCurrency,
      salaryPeriod: jobs.salaryPeriod,
      descriptionText: jobs.descriptionText,
      source: jobs.source,
      duplicateOf: jobs.duplicateOf,
      dedupeKey: jobs.dedupeKey,
      applyUrl: jobs.applyUrl,
    })
    .from(jobs)
    .where(isNull(jobs.closedAt))
    // Id order makes the lowest id win. A duplicate is always inserted after its original, so an open original is
    // kept before its duplicates; once it closes, its oldest open duplicate takes its place.
    .orderBy(asc(jobs.id))
    .all();

  // Ranking (and later scoring) the same posting twice would waste a slot and a call.
  // On one board, the same title with a different description is another opening; across sources the text is formatted
  // differently, so company and title are enough there.
  const seenFamilies = new Set<number>();
  const seenApplyUrls = new Set<string>();
  const seenByKey = new Map<string, { source: string; descriptionText: string }[]>();
  const result: RankableJob[] = [];
  for (const { source, duplicateOf, dedupeKey, applyUrl, ...job } of rows) {
    // A rejected row is neither kept nor remembered, so it can't hide a copy that passes.
    if (!keep(job)) continue;
    const family = duplicateOf ?? job.id;
    const sameKey = seenByKey.get(dedupeKey) ?? [];
    const isCopy =
      seenFamilies.has(family) ||
      (applyUrl !== null && seenApplyUrls.has(applyUrl)) ||
      sameKey.some((s) => s.source !== source || s.descriptionText === job.descriptionText);
    // Remember every row, kept or skipped, so a copy linked only through a skipped copy is caught too.
    seenFamilies.add(family);
    seenFamilies.add(job.id);
    if (applyUrl !== null) seenApplyUrls.add(applyUrl);
    seenByKey.set(dedupeKey, [...sameKey, { source, descriptionText: job.descriptionText }]);
    if (!isCopy) result.push(job);
  }
  return result;
}

// SQLite buffers can start at an offset that isn't a multiple of 4, so a Float32Array view over them can throw. Copy instead.
function toFloat32(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

export function getEmbeddings(db: Db, jobIds: number[]): Map<number, StoredEmbedding> {
  const found = new Map<number, StoredEmbedding>();
  if (jobIds.length === 0) return found;
  // SQLite limits the number of bound variables, so look ids up in chunks.
  for (let i = 0; i < jobIds.length; i += 500) {
    const rows = db.select().from(jobEmbeddings).where(inArray(jobEmbeddings.jobId, jobIds.slice(i, i + 500))).all();
    for (const r of rows) found.set(r.jobId, { model: r.model, textHash: r.textHash, vector: toFloat32(r.vector) });
  }
  return found;
}

/** Inserts or replaces the embeddings in one transaction. */
export function saveEmbeddings(
  db: Db,
  rows: { jobId: number; model: string; textHash: string; vector: Float32Array }[],
  nowIso: string,
): void {
  db.transaction((tx) => {
    for (const r of rows) {
      const vector = Buffer.from(r.vector.buffer, r.vector.byteOffset, r.vector.byteLength);
      tx.insert(jobEmbeddings)
        .values({ jobId: r.jobId, model: r.model, textHash: r.textHash, vector, createdAt: nowIso })
        .onConflictDoUpdate({
          target: jobEmbeddings.jobId,
          set: { model: r.model, textHash: r.textHash, vector, createdAt: nowIso },
        })
        .run();
    }
  });
}
