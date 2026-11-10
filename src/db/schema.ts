import { index, integer, real, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

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
    remote: integer("remote", { mode: "boolean" }),
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
  },
  (t) => [
    uniqueIndex("jobs_source_external_id_uq").on(t.source, t.externalId),
    index("jobs_dedupe_key_idx").on(t.dedupeKey),
    index("jobs_posted_at_idx").on(t.postedAt),
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
    error: text("error"),
  },
  (t) => [index("fetch_runs_source_started_idx").on(t.source, t.startedAt)],
);
