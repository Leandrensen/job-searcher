import type { Preferences } from "./config";
import { deriveSeniority } from "./seniority";

export type Exclusion = "title" | "department" | "seniority" | "salary";
export type RuleInput = {
  title: string;
  departments: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (text: string, keyword: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(keyword)}(?![\\p{L}\\p{N}])`, "iu").test(text);

const PERIODS_PER_YEAR: Record<string, number> = { month: 12, hour: 2080 };

/**
 * Applies the hard rules. A job is excluded only when its data contradicts a rule: an unknown seniority,
 * salary or currency passes. Rules are checked in a fixed order and the first failure is reported.
 */
export function checkHardRules(job: RuleInput, prefs: Preferences): { pass: true } | { pass: false; reason: Exclusion } {
  if (prefs.excludeTitleKeywords?.some((k) => mentions(job.title, k))) return { pass: false, reason: "title" };
  if (prefs.excludeDepartments?.some((k) => job.departments.some((d) => mentions(d, k)))) return { pass: false, reason: "department" };

  if (prefs.seniority) {
    const level = deriveSeniority(job.title);
    if (level !== null && !prefs.seniority.includes(level)) return { pass: false, reason: "seniority" };
  }

  const floor = job.salaryCurrency ? prefs.salaryFloor?.[job.salaryCurrency] : undefined;
  const best = job.salaryMax ?? job.salaryMin;
  if (floor !== undefined && best !== null) {
    const yearly = best * (job.salaryPeriod ? (PERIODS_PER_YEAR[job.salaryPeriod] ?? 1) : 1);
    if (yearly < floor) return { pass: false, reason: "salary" };
  }
  return { pass: true };
}
