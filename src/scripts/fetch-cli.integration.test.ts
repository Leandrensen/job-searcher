// Offline end-to-end test: real CLI + runner + all 9 adapters + in-memory DB.
// Only the network is replaced, by recorded fixtures. No mocks of project code.
import { beforeEach, describe, expect, it } from "vitest";
import type { HttpClient } from "@/core/http";
import { openDb, type Db } from "@/db/client";
import { fetchRuns, jobs } from "@/db/schema";
import { adapters } from "@/sources/registry";
import { createFixtureHttp, type FixtureHttp } from "@/test-utils/fixture-http";
import { ALL_SOURCE_ROUTES } from "@/test-utils/fixture-routes";
import { runCli, type SummaryRow } from "./fetch-cli";

type ComparableRow = Omit<SummaryRow, "ms">;

const EXPECTED_FIRST_RUN: ComparableRow[] = [
  { source: "remoteok", status: "success", fetched: 4, inserted: 3, updated: 0, invalid: 0, filtered: 1, error: "" },
  { source: "weworkremotely", status: "success", fetched: 15, inserted: 3, updated: 0, invalid: 0, filtered: 0, error: "" },
  { source: "remotive", status: "success", fetched: 3, inserted: 2, updated: 0, invalid: 0, filtered: 1, error: "" },
  { source: "himalayas", status: "success", fetched: 3, inserted: 2, updated: 0, invalid: 0, filtered: 1, error: "" },
  { source: "jobicy", status: "success", fetched: 3, inserted: 3, updated: 0, invalid: 0, filtered: 0, error: "" },
  { source: "workingnomads", status: "success", fetched: 3, inserted: 2, updated: 0, invalid: 0, filtered: 1, error: "" },
  { source: "arbeitnow", status: "success", fetched: 3, inserted: 2, updated: 0, invalid: 0, filtered: 1, error: "" },
];
const TOTAL_JOBS = 17;

const withoutMs = (r: SummaryRow): ComparableRow => ({
  source: r.source,
  status: r.status,
  fetched: r.fetched,
  inserted: r.inserted,
  updated: r.updated,
  invalid: r.invalid,
  filtered: r.filtered,
  error: r.error,
});

let db: Db;
let http: FixtureHttp;
let clock: number;

beforeEach(() => {
  db = openDb({ url: ":memory:", migrate: true });
  http = createFixtureHttp(ALL_SOURCE_ROUTES);
  clock = Date.parse("2026-11-12T12:00:00.000Z");
});

async function run(argv: string[], client: HttpClient = http) {
  const logs: string[] = [];
  const errors: string[] = [];
  const tables: SummaryRow[][] = [];
  const code = await runCli(argv, {
    openDb: () => db,
    http: client,
    adapters,
    now: () => new Date(clock),
    out: { log: (m) => logs.push(m), error: (m) => errors.push(m), table: (rows) => tables.push(rows) },
  });
  return { code, logs, errors, rows: tables[0] ?? [] };
}

describe("fetch CLI, offline end to end", () => {
  it("first run fetches every source from fixtures", async () => {
    const { code, logs, errors, rows } = await run([]);

    expect(code).toBe(0);
    expect(errors).toEqual([]);
    expect(rows.map(withoutMs)).toEqual(EXPECTED_FIRST_RUN);
    expect(logs).toContain(`Total jobs in DB: ${TOTAL_JOBS}`);

    const runs = db.select().from(fetchRuns).all();
    expect(runs).toHaveLength(7);
    expect(runs.every((r) => r.status === "success")).toBe(true);
    expect(db.select().from(jobs).all().filter((j) => j.duplicateOf !== null)).toHaveLength(0);
  });

  it("requests exactly the known urls and nothing else", async () => {
    const { rows } = await run([]);
    // A URL typo in any adapter would make that source fail, and an unknown url throws in the fixture client.
    expect(rows.every((r) => r.status === "success")).toBe(true);
    expect([...new Set(http.calls)].sort()).toEqual(Object.keys(ALL_SOURCE_ROUTES).sort());
  });

  it("second run inside the interval skips everything", async () => {
    await run([]);
    const { code, rows, logs } = await run([]);
    expect(code).toBe(0);
    expect(rows.map((r) => r.status)).toEqual(Array(7).fill("skipped"));
    expect(logs).toContain(`Total jobs in DB: ${TOTAL_JOBS}`);
  });

  it("forced second run updates instead of inserting", async () => {
    const first = await run([]);
    const { code, rows, logs } = await run(["--force"]);
    expect(code).toBe(0);
    expect(rows.map((r) => r.inserted)).toEqual(Array(7).fill(0));
    expect(rows.map((r) => r.updated)).toEqual(first.rows.map((r) => r.inserted));
    expect(logs).toContain(`Total jobs in DB: ${TOTAL_JOBS}`);
  });

  it("--source limits the run and keeps registry order", async () => {
    const { code, rows } = await run(["--source", "jobicy,remoteok"]);
    expect(code).toBe(0);
    expect(rows.map((r) => r.source)).toEqual(["remoteok", "jobicy"]);
    expect([...http.calls].sort()).toEqual(
      ["https://jobicy.com/api/v2/remote-jobs?count=100&industry=dev", "https://remoteok.com/api"].sort(),
    );
  });

  it("returns 1 when every selected source fails", async () => {
    const offline: HttpClient = {
      getJson: async () => {
        throw new Error("offline");
      },
      getText: async () => {
        throw new Error("offline");
      },
    };
    const { code, rows } = await run(["--source", "remoteok,jobicy"], offline);
    expect(code).toBe(1);
    expect(rows.map((r) => r.status)).toEqual(["error", "error"]);
    expect(rows.every((r) => r.error.includes("offline"))).toBe(true);
  });

  it("stored jobs are clean", async () => {
    await run([]);
    const stored = db.select().from(jobs).all();
    expect(stored).toHaveLength(TOTAL_JOBS);
    for (const job of stored) {
      expect(job.title.trim(), `empty title for ${job.source}/${job.externalId}`).not.toBe("");
      expect(job.company.trim(), `empty company for ${job.source}/${job.externalId}`).not.toBe("");
      expect(job.descriptionText, `${job.source}/${job.externalId}`).not.toMatch(/<\/?[a-z][^>]*>/i);
      expect(job.descriptionText, `${job.source}/${job.externalId}`).not.toMatch(/&(?:[a-z]+|#\d+|#x[0-9a-f]+);/i);
    }
  });
});
