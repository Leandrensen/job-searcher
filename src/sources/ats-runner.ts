import type { HttpClient } from "@/core/http";
import type { AtsId, Job } from "@/core/job";
import { checkJobRules, type JobFilterRules } from "@/core/job-filter-rules";
import { checkLocation, isAllowedHomeCountry } from "@/core/location-filter";
import type { Db } from "@/db/client";
import { listDueCompanies, recordCompanyFetch, type CompanyRow } from "@/db/companies";
import { markClosedJobs, recordRun, upsertJobs } from "@/db/queries";
import { runAdapter } from "./run-adapter";
import type { AnyAdapter, CompanyRef } from "./types";

export interface AtsRunSummary {
  source: string;
  status: "success" | "error" | "skipped";
  companies: number;
  companiesFailed: number;
  fetched: number;
  inserted: number;
  updated: number;
  invalid: number;
  /** Dropped by the job filter rules (keywords, seniority, salary, departments, title words). */
  filteredRules: number;
  filteredLocation: number;
  closed: number;
  latestPostedAt: string | null;
  error: string | null;
  durationMs: number;
}

export interface RunAtsSourcesOptions {
  db: Db;
  http: HttpClient;
  adapters: AnyAdapter[];
  force?: boolean;
  now?: () => Date;
  log?: (msg: string) => void;
  /** The user's job filter rules: a job is stored only if it passes them (and the location filter). */
  rules: JobFilterRules;
}

const errorMessage = (err: unknown): string => {
  const e = err instanceof Error ? err : new Error(String(err));
  return `${e.name}: ${e.message}`;
};

const toRef = (c: CompanyRow): CompanyRef => ({ id: c.id, ats: c.ats as AtsId, slug: c.slug, name: c.name, homeCountry: c.homeCountry });

/**
 * Fetches every due company of each ATS (ATSs in parallel, companies of one ATS one after another, so the
 * paced client keeps each host to its rate), stores the jobs that pass the tech and location filters,
 * and closes the company's jobs that disappeared. Never rejects.
 */
export async function runAtsSources(opts: RunAtsSourcesOptions): Promise<AtsRunSummary[]> {
  const { db, http, adapters, force = false, rules } = opts;
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? (() => {});

  async function runOne(adapter: AnyAdapter): Promise<AtsRunSummary> {
    const startedAt = now();
    const startMs = Date.now();
    const summary: AtsRunSummary = {
      source: adapter.id,
      status: "success",
      companies: 0,
      companiesFailed: 0,
      fetched: 0,
      inserted: 0,
      updated: 0,
      invalid: 0,
      filteredRules: 0,
      filteredLocation: 0,
      closed: 0,
      latestPostedAt: null,
      error: null,
      durationMs: 0,
    };
    try {
      const all = listDueCompanies(db, adapter.id as AtsId, startedAt.toISOString(), { force });
      // Every job of a company based in a disallowed country fails the location filter, so don't spend requests on it.
      const due = all.filter((c) => isAllowedHomeCountry(c.homeCountry));
      const skippedCountry = all.length - due.length;
      if (skippedCountry > 0) log(`${adapter.id}: skipped ${skippedCountry} companies based outside the allowed countries`);
      summary.companies = due.length;
      if (due.length === 0) {
        summary.status = "skipped";
      }
      for (const [index, company] of due.entries()) {
        const label = `${adapter.id}/${company.slug}`;
        const nowIso = now().toISOString();
        try {
          // Postings an adapter drops before its detail requests (SmartRecruiters) never reach the result, so count them here.
          let preRules = 0;
          let preLocation = 0;
          const onPrefiltered = (reason: "rules" | "location") => (reason === "rules" ? preRules++ : preLocation++);
          const result = await runAdapter(adapter, { http, companies: [toRef(company)], latestPostedAt: null, log, rules, onPrefiltered });
          if (result.status === "error" && result.httpStatus === 429) {
            // The host is rate limiting us. Hitting it again only prolongs the block, so stop and leave every
            // remaining company due (nothing is recorded for them, so none moves toward deactivation).
            const skipped = due.length - index - 1;
            summary.companiesFailed += 1 + skipped;
            summary.error ??= result.error;
            log(`${label}: ${result.error}`);
            log(`${adapter.id}: rate limited, skipping the other ${skipped} companies until the next run`);
            break;
          }
          if (result.status === "error") {
            const notFound = result.httpStatus === 404;
            const message = result.error ?? "unknown error";
            recordCompanyFetch(db, company.id, notFound ? { kind: "not_found", error: message } : { kind: "error", error: message }, nowIso);
            summary.companiesFailed++;
            summary.error ??= message;
            log(`${label}: ${message}`);
            continue;
          }
          const kept: Job[] = [];
          let ruleMisses = result.filtered + preRules;
          let location = preLocation;
          for (const job of result.jobs) {
            if (!checkJobRules(job, rules).pass) ruleMisses++;
            else if (!checkLocation(job, company.homeCountry).pass) location++;
            else kept.push(job);
          }
          const { inserted, updated, closed } = db.transaction((tx) => {
            const counts = upsertJobs(tx, kept, nowIso, { companyId: company.id });
            // An incomplete list (some postings failed validation) can't tell which jobs vanished, so close nothing.
            const closedCount = result.invalid > 0 ? 0 : markClosedJobs(tx, company.id, kept.map((j) => j.externalId), nowIso);
            return { ...counts, closed: closedCount };
          });
          recordCompanyFetch(db, company.id, { kind: "success" }, nowIso);
          summary.fetched += result.fetched + preRules + preLocation;
          summary.invalid += result.invalid;
          summary.inserted += inserted;
          summary.updated += updated;
          summary.closed += closed;
          summary.filteredRules += ruleMisses;
          summary.filteredLocation += location;
          if (result.latestPostedAt && (!summary.latestPostedAt || result.latestPostedAt > summary.latestPostedAt)) {
            summary.latestPostedAt = result.latestPostedAt;
          }
          if (result.invalid > 0) log(`${label}: ${result.invalid} invalid items, no jobs closed this run`);
          log(`${label}: kept ${kept.length}, filtered ${ruleMisses}+${location}, closed ${closed}`);
        } catch (err) {
          const message = errorMessage(err);
          summary.companiesFailed++;
          summary.error ??= message;
          log(`${label}: ${message}`);
          try {
            recordCompanyFetch(db, company.id, { kind: "error", error: message }, nowIso);
          } catch (recordErr) {
            log(`${label}: could not record failure: ${errorMessage(recordErr)}`);
          }
        }
      }
      if (summary.companies > 0 && summary.companiesFailed === summary.companies) summary.status = "error";
      summary.durationMs = Date.now() - startMs;
      recordRun(db, {
        source: adapter.id,
        startedAt: startedAt.toISOString(),
        finishedAt: now().toISOString(),
        status: summary.status,
        fetched: summary.fetched,
        inserted: summary.inserted,
        updated: summary.updated,
        invalid: summary.invalid,
        filtered: summary.filteredRules + summary.filteredLocation,
        latestPostedAt: summary.latestPostedAt,
        error: summary.error,
      });
      return summary;
    } catch (err) {
      const message = errorMessage(err);
      log(`${adapter.id}: could not record run: ${message}`);
      return { ...summary, status: "error", error: message, durationMs: Date.now() - startMs };
    }
  }

  return Promise.all(adapters.map(runOne));
}
