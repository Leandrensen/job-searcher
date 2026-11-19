import { checkHardRules, type Exclusion, type RuleInput } from "./hard-rules";
import type { Preferences } from "./config";
import { cosine } from "./vectors";

/** Keeps the jobs that pass the hard rules, in their input order, and counts the exclusions by reason. */
export function applyHardRules<J extends RuleInput>(jobs: J[], prefs: Preferences): { kept: J[]; excluded: Record<Exclusion, number> } {
  const kept: J[] = [];
  const excluded: Record<Exclusion, number> = { title: 0, department: 0, seniority: 0, salary: 0 };
  for (const job of jobs) {
    const verdict = checkHardRules(job, prefs);
    if (verdict.pass) kept.push(job);
    else excluded[verdict.reason]++;
  }
  return { kept, excluded };
}

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
