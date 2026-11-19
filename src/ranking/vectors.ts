import { createHash } from "node:crypto";

/** About 1,500 tokens: enough to read a posting while bounding CPU time. */
export const EMBED_MAX_CHARS = 6000;

/** The text that is embedded for a job: the title, a blank line, then the description. */
export function buildEmbeddingText(job: { title: string; descriptionText: string }): string {
  return `${job.title.trim()}\n\n${job.descriptionText.trim()}`.trim().slice(0, EMBED_MAX_CHARS);
}

/** Identifies what was embedded: a different model or text gives a different hash. */
export function textHash(model: string, text: string): string {
  return createHash("sha256").update(`${model}\n${text}`).digest("hex");
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error(`cosine: vectors have different lengths (${a.length} vs ${b.length})`);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
