import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { normalizeCompany } from "@/core/dedupe";
import type { AtsId } from "@/core/job";
import type { Resolution } from "@/companies/types";
import type { Db } from "./client";
import { companies, companyCandidates, jobs } from "./schema";

export type CandidateRow = typeof companyCandidates.$inferSelect;
export type CompanyRow = typeof companies.$inferSelect;

export interface CandidateInput {
  name: string;
  website?: string | null;
  careersUrl?: string | null;
  atsHints?: string[];
  homeCountry?: string | null;
  origin: string;
}

const addDays = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86_400_000).toISOString();
const addHours = (iso: string, hours: number) => new Date(Date.parse(iso) + hours * 3_600_000).toISOString();
const clean = (v: string | null | undefined) => (v && v.trim() !== "" ? v.trim() : null);

/** Insert a candidate, or merge into the existing one with the same normalized name. */
export function upsertCandidate(db: Db, input: CandidateInput, nowIso: string): "inserted" | "updated" | "unchanged" {
  const normalizedName = normalizeCompany(input.name);
  if (normalizedName === "") return "unchanged";
  const existing = db.select().from(companyCandidates).where(eq(companyCandidates.normalizedName, normalizedName)).get();

  if (!existing) {
    db.insert(companyCandidates)
      .values({
        normalizedName,
        name: input.name.trim(),
        website: clean(input.website),
        careersUrl: clean(input.careersUrl),
        atsHints: [...new Set(input.atsHints ?? [])],
        homeCountry: clean(input.homeCountry),
        origin: input.origin,
        createdAt: nowIso,
      })
      .run();
    return "inserted";
  }

  const patch: Partial<typeof companyCandidates.$inferInsert> = {};
  if (existing.website === null && clean(input.website)) patch.website = clean(input.website);
  if (existing.careersUrl === null && clean(input.careersUrl)) patch.careersUrl = clean(input.careersUrl);
  if (existing.homeCountry === null && clean(input.homeCountry)) patch.homeCountry = clean(input.homeCountry);
  const merged = [...new Set([...existing.atsHints, ...(input.atsHints ?? [])])];
  const addedHint = merged.length > existing.atsHints.length;
  if (addedHint) {
    patch.atsHints = merged;
    if (existing.status === "not_found" || existing.status === "error" || existing.status === "ambiguous") {
      patch.status = "pending";
      patch.nextCheckAt = null;
      patch.ambiguousMatches = [];
    }
  }
  if (Object.keys(patch).length === 0) return "unchanged";
  db.update(companyCandidates).set(patch).where(eq(companyCandidates.id, existing.id)).run();
  return "updated";
}

/** Candidates that need a resolution attempt: pending, or not_found/error whose next check has arrived. */
export function listDueCandidates(db: Db, nowIso: string, limit?: number): CandidateRow[] {
  const q = db
    .select()
    .from(companyCandidates)
    .where(
      or(
        eq(companyCandidates.status, "pending"),
        and(inArray(companyCandidates.status, ["not_found", "error"]), lte(companyCandidates.nextCheckAt, nowIso)),
      ),
    )
    .orderBy(asc(companyCandidates.createdAt), asc(companyCandidates.id));
  return limit === undefined ? q.all() : q.limit(limit).all();
}

export function insertOrGetCompany(
  db: Db,
  c: { ats: AtsId; slug: string; name: string; website: string | null; homeCountry: string | null; origin: string },
  nowIso: string,
): number {
  const existing = db
    .select({ id: companies.id, status: companies.status })
    .from(companies)
    .where(and(eq(companies.ats, c.ats), eq(companies.slug, c.slug)))
    .get();
  if (existing) {
    // The board answers again (a candidate was confirmed to it), so a deactivated company must be fetched again.
    if (existing.status === "inactive") {
      db.update(companies).set({ status: "active", consecutiveFailures: 0, lastError: null }).where(eq(companies.id, existing.id)).run();
    }
    return existing.id;
  }
  return db
    .insert(companies)
    .values({ ...c, status: "active", createdAt: nowIso })
    .returning({ id: companies.id })
    .get().id;
}

/** From this many error resolutions in a row, a candidate is retried monthly instead of daily. */
const ERRORS_BEFORE_BACKOFF = 5;

export function recordResolution(db: Db, candidateId: number, result: Resolution, nowIso: string): { companyId: number | null } {
  return db.transaction((tx) => {
    const cand = tx.select().from(companyCandidates).where(eq(companyCandidates.id, candidateId)).get();
    if (!cand) throw new Error(`Unknown candidate ${candidateId}`);
    const base = { attempts: cand.attempts + 1, lastCheckedAt: nowIso };

    switch (result.status) {
      case "confirmed": {
        const companyId = insertOrGetCompany(
          tx,
          { ats: result.ats, slug: result.slug, name: cand.name, website: cand.website, homeCountry: cand.homeCountry, origin: cand.origin },
          nowIso,
        );
        tx.update(companyCandidates)
          .set({ ...base, status: "confirmed", companyId, ambiguousMatches: [], nextCheckAt: null, consecutiveErrors: 0 })
          .where(eq(companyCandidates.id, candidateId))
          .run();
        return { companyId };
      }
      case "ambiguous":
        tx.update(companyCandidates)
          .set({ ...base, status: "ambiguous", ambiguousMatches: result.matches, nextCheckAt: null, consecutiveErrors: 0 })
          .where(eq(companyCandidates.id, candidateId))
          .run();
        return { companyId: null };
      case "not_found":
        tx.update(companyCandidates)
          .set({ ...base, status: "not_found", ambiguousMatches: [], nextCheckAt: addDays(nowIso, 30), consecutiveErrors: 0 })
          .where(eq(companyCandidates.id, candidateId))
          .run();
        return { companyId: null };
      case "error": {
        // A probe that fails every time (say, a response we can't parse) would otherwise be retried daily forever.
        // Being rate-limited says nothing about the candidate, so it is retried tomorrow without counting.
        const errors = result.rateLimited === true ? cand.consecutiveErrors : cand.consecutiveErrors + 1;
        const days = result.rateLimited !== true && errors >= ERRORS_BEFORE_BACKOFF ? 30 : 1;
        tx.update(companyCandidates)
          .set({ ...base, status: "error", consecutiveErrors: errors, nextCheckAt: addDays(nowIso, days) })
          .where(eq(companyCandidates.id, candidateId))
          .run();
        return { companyId: null };
      }
    }
  });
}

/** The user said this candidate is not a company we want. It is never resolved again, not even on a new hint. */
export function rejectCandidate(db: Db, candidateId: number, nowIso: string): void {
  const changes = db
    .update(companyCandidates)
    .set({ status: "rejected", ambiguousMatches: [], nextCheckAt: null, lastCheckedAt: nowIso })
    .where(eq(companyCandidates.id, candidateId))
    .run().changes;
  if (changes === 0) throw new Error(`Unknown candidate ${candidateId}`);
}

/** Active companies of one ATS that haven't been fetched in the last `minHours` (default 20). */
export function listDueCompanies(
  db: Db,
  ats: AtsId,
  nowIso: string,
  opts: { force?: boolean; minHours?: number } = {},
): CompanyRow[] {
  const cutoff = addHours(nowIso, -(opts.minHours ?? 20));
  const due = opts.force ? undefined : or(isNull(companies.lastFetchedAt), lte(companies.lastFetchedAt, cutoff));
  return db
    .select()
    .from(companies)
    .where(and(eq(companies.ats, ats), eq(companies.status, "active"), due))
    .orderBy(asc(companies.id))
    .all();
}

const MAX_CONSECUTIVE_404S = 3;

export function recordCompanyFetch(
  db: Db,
  companyId: number,
  outcome: { kind: "success" } | { kind: "not_found"; error: string } | { kind: "error"; error: string },
  nowIso: string,
): void {
  db.transaction((tx) => {
    if (outcome.kind === "success") {
      tx.update(companies)
        .set({ consecutiveFailures: 0, lastFetchedAt: nowIso, lastError: null })
        .where(eq(companies.id, companyId))
        .run();
      return;
    }
    if (outcome.kind === "error") {
      tx.update(companies).set({ lastError: outcome.error, lastFetchedAt: nowIso }).where(eq(companies.id, companyId)).run();
      return;
    }
    tx.update(companies)
      .set({ consecutiveFailures: sql`${companies.consecutiveFailures} + 1`, lastError: outcome.error, lastFetchedAt: nowIso })
      .where(eq(companies.id, companyId))
      .run();
    const row = tx.select().from(companies).where(eq(companies.id, companyId)).get();
    if (row && row.consecutiveFailures >= MAX_CONSECUTIVE_404S) {
      tx.update(companies).set({ status: "inactive" }).where(eq(companies.id, companyId)).run();
      // A board that no longer exists has no open jobs, so they must not keep counting as open.
      tx.update(jobs).set({ closedAt: nowIso }).where(and(eq(jobs.companyId, companyId), isNull(jobs.closedAt))).run();
      tx.update(companyCandidates)
        .set({ status: "pending", nextCheckAt: null, companyId: null })
        .where(eq(companyCandidates.companyId, companyId))
        .run();
    }
  });
}

export function listAmbiguousCandidates(db: Db): CandidateRow[] {
  return db.select().from(companyCandidates).where(eq(companyCandidates.status, "ambiguous")).orderBy(asc(companyCandidates.id)).all();
}

export function companyCounts(db: Db): { active: number; inactive: number; byAts: Record<string, number> } {
  const rows = db.select({ ats: companies.ats, status: companies.status }).from(companies).all();
  const byAts: Record<string, number> = {};
  let active = 0;
  let inactive = 0;
  for (const r of rows) {
    if (r.status === "active") {
      active++;
      byAts[r.ats] = (byAts[r.ats] ?? 0) + 1;
    } else {
      inactive++;
    }
  }
  return { active, inactive, byAts };
}

export function getCandidate(db: Db, id: number): CandidateRow | undefined {
  return db.select().from(companyCandidates).where(eq(companyCandidates.id, id)).get();
}

export function findCandidateByName(db: Db, name: string): CandidateRow | undefined {
  return db.select().from(companyCandidates).where(eq(companyCandidates.normalizedName, normalizeCompany(name))).get();
}

export function listActiveCompanies(db: Db): CompanyRow[] {
  return db.select().from(companies).where(eq(companies.status, "active")).orderBy(asc(companies.id)).all();
}

/**
 * Add a company by hand (confirmed by definition). If it already exists it is reactivated, and its name and
 * home country are updated only when given.
 */
export function addManualCompany(
  db: Db,
  c: { ats: AtsId; slug: string; name: string | null; homeCountry: string | null; website?: string | null },
  nowIso: string,
): { companyId: number; created: boolean; name: string } {
  const existing = db
    .select()
    .from(companies)
    .where(and(eq(companies.ats, c.ats), eq(companies.slug, c.slug)))
    .get();
  if (!existing) {
    const name = c.name ?? c.slug;
    const companyId = insertOrGetCompany(
      db,
      { ats: c.ats, slug: c.slug, name, website: c.website ?? null, homeCountry: c.homeCountry, origin: "manual" },
      nowIso,
    );
    return { companyId, created: true, name };
  }
  const name = c.name ?? existing.name;
  db.update(companies)
    .set({ name, homeCountry: c.homeCountry ?? existing.homeCountry, status: "active", consecutiveFailures: 0 })
    .where(eq(companies.id, existing.id))
    .run();
  return { companyId: existing.id, created: false, name };
}
