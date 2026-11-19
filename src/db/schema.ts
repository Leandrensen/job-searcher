import { blob, index, integer, real, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { ATS_IDS } from "../core/job";

export const companies = sqliteTable(
  "companies",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ats: text("ats", { enum: ATS_IDS }).notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    website: text("website"),
    /** ISO 3166-1 alpha-2, uppercase. */
    homeCountry: text("home_country"),
    /** `seed:remoteintech` | `seed:yc` | `board:<boardId>` | `manual`. */
    origin: text("origin").notNull(),
    status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
    /** Consecutive 404s; any other recorded outcome resets it. */
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    /** Last fetch attempt: success, 404 or error (not a 429 skip). */
    lastFetchedAt: text("last_fetched_at"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("companies_ats_slug_uq").on(t.ats, t.slug)],
);

export const companyCandidates = sqliteTable(
  "company_candidates",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    normalizedName: text("normalized_name").notNull().unique(),
    name: text("name").notNull(),
    website: text("website"),
    careersUrl: text("careers_url"),
    /** ATS URLs seen in board postings. */
    atsHints: text("ats_hints", { mode: "json" }).$type<string[]>().notNull().default([]),
    homeCountry: text("home_country"),
    origin: text("origin").notNull(),
    status: text("status", { enum: ["pending", "confirmed", "ambiguous", "not_found", "error", "rejected"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    /** Error resolutions in a row; reset by any other result. */
    consecutiveErrors: integer("consecutive_errors").notNull().default(0),
    lastCheckedAt: text("last_checked_at"),
    /** null means due now. */
    nextCheckAt: text("next_check_at"),
    companyId: integer("company_id").references(() => companies.id),
    ambiguousMatches: text("ambiguous_matches", { mode: "json" })
      .$type<{ ats: string; slug: string }[]>()
      .notNull()
      .default([]),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("company_candidates_status_next_check_idx").on(t.status, t.nextCheckAt)],
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    applyUrl: text("apply_url"),
    title: text("title").notNull(),
    company: text("company").notNull(),
    location: text("location"),
    workplaceType: text("workplace_type"),
    departments: text("departments", { mode: "json" }).$type<string[]>().notNull().default([]),
    regions: text("regions", { mode: "json" }).$type<string[]>().notNull().default([]),
    employmentType: text("employment_type"),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),
    salaryMin: real("salary_min"),
    salaryMax: real("salary_max"),
    salaryCurrency: text("salary_currency"),
    salaryPeriod: text("salary_period"),
    descriptionHtml: text("description_html").notNull(),
    descriptionText: text("description_text").notNull(),
    postedAt: text("posted_at"),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    duplicateOf: integer("duplicate_of").references((): AnySQLiteColumn => jobs.id),
    // Companies are deactivated, never deleted, so no ON DELETE action is needed (and the live DB has none).
    companyId: integer("company_id").references(() => companies.id),
    closedAt: text("closed_at"),
  },
  (t) => [
    uniqueIndex("jobs_source_external_id_uq").on(t.source, t.externalId),
    index("jobs_dedupe_key_idx").on(t.dedupeKey),
    index("jobs_posted_at_idx").on(t.postedAt),
    index("jobs_company_idx").on(t.companyId),
    index("jobs_closed_at_idx").on(t.closedAt),
  ],
);

export const fetchRuns = sqliteTable(
  "fetch_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    source: text("source").notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at").notNull(),
    status: text("status", { enum: ["success", "error", "skipped"] }).notNull(),
    fetched: integer("fetched").notNull().default(0),
    inserted: integer("inserted").notNull().default(0),
    updated: integer("updated").notNull().default(0),
    invalid: integer("invalid").notNull().default(0),
    filtered: integer("filtered").notNull().default(0),
    /** Newest postedAt seen in this run. Boards keep no jobs, so this drives their incremental paging. */
    latestPostedAt: text("latest_posted_at"),
    error: text("error"),
  },
  (t) => [index("fetch_runs_source_started_idx").on(t.source, t.startedAt)],
);

/** One local embedding per job. Re-computed only when the model or the embedded text (its hash) changes. */
export const jobEmbeddings = sqliteTable("job_embeddings", {
  jobId: integer("job_id")
    .primaryKey()
    .references(() => jobs.id),
  model: text("model").notNull(),
  textHash: text("text_hash").notNull(),
  /** Float32Array bytes, little-endian. */
  vector: blob("vector", { mode: "buffer" }).notNull(),
  createdAt: text("created_at").notNull(),
});
