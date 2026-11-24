import { z } from "zod";
import { deriveSeniority, SENIORITY_LEVELS } from "./seniority";

// An entry without a letter or digit (say "-") normalizes to an empty pattern that would match every job.
const nonEmptyStrings = z.array(z.string().trim().regex(/[\p{L}\p{N}]/u, "must contain a letter or digit"));

/** Every job filter the user controls (config/job-filter-rules.json). Applied once, at fetch. */
export const JobFilterRulesSchema = z
  .object({
    /** A job (or board posting) must match at least one, on its title, departments or tags. */
    keywords: nonEmptyStrings.min(1),
    /** Allowed seniority levels, read from the title. */
    seniority: z.array(z.enum(SENIORITY_LEVELS)).min(1).optional(),
    /** Minimum yearly salary per ISO 4217 currency. */
    salaryFloor: z.record(z.string().regex(/^[A-Z]{3}$/), z.number().positive()).optional(),
    excludeDepartments: nonEmptyStrings.optional(),
    excludeTitleKeywords: nonEmptyStrings.optional(),
  })
  .strict();
export type JobFilterRules = z.infer<typeof JobFilterRulesSchema>;

export type RuleRejection = "keywords" | "title" | "department" | "seniority" | "salary";
export type RuleInput = {
  title: string;
  departments: string[];
  tags: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalize = (s: string) => s.toLowerCase().replace(/[-_/]/g, " ").replace(/\s+/g, " ").trim();
// Exclusions normalize both sides like keywords do, so "front end" excludes "Front-End Developer".
const mentions = (text: string, phrase: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(normalize(phrase))}(?![\\p{L}\\p{N}])`, "u").test(normalize(text));

/** Whether the title, departments or tags contain a keyword as whole words (any letter or digit, accented or not, is part of a word; descriptions are never read). */
export function matchesKeywords(job: Pick<RuleInput, "title" | "departments" | "tags">, keywords: readonly string[]): boolean {
  const haystack = normalize([job.title, ...job.departments, ...job.tags].join(" | "));
  return keywords.some((k) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(normalize(k))}(?![\\p{L}\\p{N}])`, "u").test(haystack));
}

const PERIODS_PER_YEAR: Record<string, number> = { year: 1, month: 12, hour: 2080 };

/**
 * Applies the rules in a fixed order and reports the first one that fails. Unknown values pass: a title with no
 * seniority, a job with no salary, an unknown currency or an unknown pay period never excludes a job.
 */
export function checkJobRules(job: RuleInput, rules: JobFilterRules): { pass: true } | { pass: false; reason: RuleRejection } {
  if (!matchesKeywords(job, rules.keywords)) return { pass: false, reason: "keywords" };
  if (rules.excludeTitleKeywords?.some((k) => mentions(job.title, k))) return { pass: false, reason: "title" };
  if (rules.excludeDepartments?.some((k) => job.departments.some((d) => mentions(d, k)))) return { pass: false, reason: "department" };

  if (rules.seniority) {
    const level = deriveSeniority(job.title);
    if (level !== null && !rules.seniority.includes(level)) return { pass: false, reason: "seniority" };
  }

  const floor = job.salaryCurrency ? rules.salaryFloor?.[job.salaryCurrency] : undefined;
  const perYear = job.salaryPeriod ? PERIODS_PER_YEAR[job.salaryPeriod] : undefined;
  const best = job.salaryMax ?? job.salaryMin;
  if (floor !== undefined && perYear !== undefined && best !== null && best * perYear < floor) return { pass: false, reason: "salary" };
  return { pass: true };
}
