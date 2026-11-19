import type { Db } from "@/db/client";
import { getEmbeddings, saveEmbeddings, type RankableJob } from "@/db/ranking";
import type { Embedder } from "./embedder";
import { buildEmbeddingText, textHash } from "./vectors";

const DEFAULT_BATCH_SIZE = 16;

/**
 * Returns a vector for every job, embedding only the ones that have none or whose model or text changed.
 * Each batch is saved before the next one starts, so an interrupted run resumes where it stopped.
 */
export async function embedJobs(
  db: Db,
  embedder: Embedder,
  jobs: RankableJob[],
  opts: { nowIso: string; batchSize?: number; log?: (msg: string) => void },
): Promise<{ vectors: Map<number, Float32Array>; embedded: number; reused: number }> {
  const log = opts.log ?? (() => {});
  const batchSize = Math.max(1, opts.batchSize ?? DEFAULT_BATCH_SIZE);
  const vectors = new Map<number, Float32Array>();
  const queued: { id: number; text: string; hash: string }[] = [];

  const stored = getEmbeddings(db, jobs.map((j) => j.id));
  for (const job of jobs) {
    const text = buildEmbeddingText(job);
    const hash = textHash(embedder.model, text);
    const existing = stored.get(job.id);
    if (existing && existing.model === embedder.model && existing.textHash === hash) vectors.set(job.id, existing.vector);
    else queued.push({ id: job.id, text, hash });
  }
  const reused = vectors.size;

  for (let i = 0; i < queued.length; i += batchSize) {
    const batch = queued.slice(i, i + batchSize);
    const result = await embedder.embed(batch.map((b) => b.text));
    if (result.length !== batch.length) throw new Error(`embedder returned ${result.length} vectors for ${batch.length} texts`);
    for (const v of result) {
      if (v.length !== embedder.dimensions) throw new Error(`embedder returned a vector of length ${v.length}, expected ${embedder.dimensions}`);
    }
    saveEmbeddings(
      db,
      batch.map((b, k) => ({ jobId: b.id, model: embedder.model, textHash: b.hash, vector: result[k]! })),
      opts.nowIso,
    );
    batch.forEach((b, k) => vectors.set(b.id, result[k]!));
    log(`embed: ${Math.min(i + batchSize, queued.length)}/${queued.length}`);
  }
  return { vectors, embedded: queued.length, reused };
}
