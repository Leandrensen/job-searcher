import { and, asc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Db } from "./client";
import { jobEmbeddings, jobs } from "./schema";

export type RankableJob = {
  id: number;
  title: string;
  company: string;
  location: string | null;
  url: string;
  departments: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  descriptionText: string;
};

export type StoredEmbedding = { model: string; textHash: string; vector: Float32Array };

/**
 * Open jobs to rank, in id order. A duplicate is skipped while its original is open; once the original closes, its oldest
 * open duplicate takes its place.
 */
export function listOpenJobsForRanking(db: Db): RankableJob[] {
  const original = alias(jobs, "original");
  const rows = db
    .select({
      id: jobs.id,
      title: jobs.title,
      company: jobs.company,
      location: jobs.location,
      url: jobs.url,
      departments: jobs.departments,
      salaryMin: jobs.salaryMin,
      salaryMax: jobs.salaryMax,
      salaryCurrency: jobs.salaryCurrency,
      salaryPeriod: jobs.salaryPeriod,
      descriptionText: jobs.descriptionText,
      duplicateOf: jobs.duplicateOf,
    })
    .from(jobs)
    // Left join: a job that isn't a duplicate has no original and must still be listed.
    .leftJoin(original, eq(original.id, jobs.duplicateOf))
    // A duplicate of an open posting is the same job: ranking (and later scoring) it twice would waste a slot and a call.
    // A missing original counts as gone.
    .where(
      and(
        isNull(jobs.closedAt),
        or(isNull(jobs.duplicateOf), isNull(original.id), isNotNull(original.closedAt)),
      ),
    )
    .orderBy(asc(jobs.id))
    .all();

  // Several open copies of one closed original: keep only the first (lowest id), so the job still appears once.
  const keptOriginals = new Set<number>();
  const result: RankableJob[] = [];
  for (const { duplicateOf, ...job } of rows) {
    if (duplicateOf !== null) {
      if (keptOriginals.has(duplicateOf)) continue;
      keptOriginals.add(duplicateOf);
    }
    result.push(job);
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
