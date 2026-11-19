import type { Job } from "./job";
import { ALLOWED_JOB_REGIONS, EUROPEAN_COUNTRY_CODES } from "./locations";

/** Home countries we accept: the US, Canada, Australia, New Zealand and every European country. */
export const ALLOWED_HOME_COUNTRIES: ReadonlySet<string> = new Set(["US", "CA", "AU", "NZ", ...EUROPEAN_COUNTRY_CODES]);

/** An unknown home country passes. */
export function isAllowedHomeCountry(code: string | null): boolean {
  return code === null || ALLOWED_HOME_COUNTRIES.has(code);
}

export type LocationVerdict =
  | { pass: true }
  | { pass: false; reason: "hybrid" | "onsite" | "region" | "company_country" };

/**
 * Storage location filter: remote only, doable from Argentina, at a company based in an allowed country.
 * Unknown values pass. Returns the first failing rule.
 */
export function checkLocation(job: Pick<Job, "workplaceType" | "regions">, homeCountry: string | null): LocationVerdict {
  if (job.workplaceType === "hybrid") return { pass: false, reason: "hybrid" };
  if (job.workplaceType === "onsite") return { pass: false, reason: "onsite" };
  if (job.regions.length > 0 && !job.regions.some((r) => (ALLOWED_JOB_REGIONS as readonly string[]).includes(r))) {
    return { pass: false, reason: "region" };
  }
  if (!isAllowedHomeCountry(homeCountry)) return { pass: false, reason: "company_country" };
  return { pass: true };
}
