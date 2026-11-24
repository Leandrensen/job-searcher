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

/** Jobs that pass the job filter rules, in their original order, and how many were skipped. */
export function filterByRules<J extends RuleInput>(jobs: J[], rules: JobFilterRules): { passing: J[]; skipped: number } {
  const passing = jobs.filter((job) => checkJobRules(job, rules).pass);
  return { passing, skipped: jobs.length - passing.length };
}
