import { checkJobRules, type JobFilterRules, type RuleInput } from "@/core/job-filter-rules";
import { cosine } from "./vectors";

/** The `topN` jobs most similar to the search, best first. A job without a vector is skipped. */
export function rankJobs<J extends { id: number }>(
  jobs: J[],
  vectors: Map<number, Float32Array>,
  searchVector: Float32Array,
  topN: number,
): { job: J; similarity: number }[] {
  const scored: { job: J; similarity: number }[] = [];
  for (const job of jobs) {
    const vector = vectors.get(job.id);
    if (vector) scored.push({ job, similarity: cosine(vector, searchVector) });
  }
  scored.sort((a, b) => b.similarity - a.similarity || a.job.id - b.job.id);
  return scored.slice(0, topN);
}

/** A predicate for the job filter rules that counts the jobs it rejects. */
export function createRuleFilter(rules: JobFilterRules): { keep: (job: RuleInput) => boolean; skipped: () => number } {
  let skipped = 0;
  return {
    keep(job) {
      const pass = checkJobRules(job, rules).pass;
      if (!pass) skipped++;
      return pass;
    },
    skipped: () => skipped,
  };
}
