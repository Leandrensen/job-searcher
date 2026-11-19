import { z } from "zod";
import { HttpError } from "@/core/http";
import { ATS_IDS, type AtsId } from "@/core/job";
import type { ProbeResult } from "@/companies/types";
import type { CompanyRef, FetchContext } from "../types";

export const CompanyRefSchema = z.object({
  id: z.number(),
  ats: z.enum(ATS_IDS),
  slug: z.string(),
  name: z.string(),
  homeCountry: z.string().nullable(),
});

/** ATS adapters fetch a company at a time and return `{ company, item }` wrappers. */
export function wrapperSchema<T extends z.ZodType>(item: T) {
  return z.object({ company: CompanyRefSchema, item });
}

export function requireCompanies(ctx: FetchContext, id: AtsId): CompanyRef[] {
  if (!ctx.companies || ctx.companies.length === 0) throw new Error(`${id}: no companies in context`);
  return ctx.companies;
}

/** Trimmed, non-empty, unique values in first-seen order. */
export function uniqueNonEmpty(values: ReadonlyArray<string | null | undefined>): string[] {
  return [...new Set(values.map((v) => v?.trim()).filter((v): v is string => !!v))];
}

/** Location strings joined for display, or null when there are none. */
export function displayLocation(texts: string[]): string | null {
  const parts = uniqueNonEmpty(texts);
  return parts.length > 0 ? parts.join(" | ") : null;
}

export const NOT_FOUND_PROBE: ProbeResult = { exists: false, postingCount: 0, companyName: null, texts: [], urls: [] };

/** Runs `fn`; an HTTP 404 becomes `null`, any other error is re-thrown. */
export async function nullOn404<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
}
