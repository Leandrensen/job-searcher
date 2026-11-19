// Offline end-to-end test of the M2 flow: seed, resolve, fetch, close, purge, review.
// Real CLIs, runners, adapters and an in-memory DB. Only the network is replaced, by hand-written fixtures.
import { beforeAll, describe, expect, it } from "vitest";
import { REMOTEINTECH_RAW_BASE, REMOTEINTECH_TREE_URL, YC_ALL_URL } from "@/companies/seeds";
import { openDb, type Db } from "@/db/client";
import { companies, companyCandidates, jobs } from "@/db/schema";
import { atsAdapters, atsProbes, boardAdapters } from "@/sources/registry";
import { createFixtureHttp, type FixtureRoute } from "@/test-utils/fixture-http";
import { ALL_SOURCE_ROUTES } from "@/test-utils/fixture-routes";
import { runCompanyCli } from "./company-cli";
import { runFetchCli, type AtsSummaryRow, type SummaryRow } from "./fetch-cli";
import { runSeedCli } from "./seed-cli";

const NO_PACING = { minIntervalMs: 0, perHostMinIntervalMs: {} };
const ACME_JOBS = "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true";
const ASHBY_INITECH = "https://api.ashbyhq.com/posting-api/job-board/initech?includeCompensation=true";

const ROUTES: Record<string, FixtureRoute> = {
  ...ALL_SOURCE_ROUTES,
  [REMOTEINTECH_TREE_URL]: "integration/tree.json",
  [`${REMOTEINTECH_RAW_BASE}src/companies/acme.md`]: "integration/acme.md",
  [`${REMOTEINTECH_RAW_BASE}src/companies/globex.md`]: "integration/globex.md",
  [YC_ALL_URL]: "integration/yc.json",
  "https://boards-api.greenhouse.io/v1/boards/acme": "integration/gh-board-acme.json",
  [ACME_JOBS]: "integration/gh-jobs-acme.json",
  "https://api.lever.co/v0/postings/globex?mode=json": "integration/lever-globex.json",
  [ASHBY_INITECH]: "integration/ashby-initech.json",
};

const T0 = Date.parse("2026-11-16T12:00:00.000Z");
let clock = T0;
let db: Db;
let routes: Record<string, FixtureRoute>;

function io() {
  const logs: string[] = [];
  const errors: string[] = [];
  const tables: Array<Array<Record<string, string | number>>> = [];
  return {
    logs,
    errors,
    tables,
    out: { log: (m: string) => logs.push(m), error: (m: string) => errors.push(m), table: (rows: unknown[]) => tables.push(rows as Array<Record<string, string | number>>) },
  };
}

const http = () => createFixtureHttp(routes, { fallbackStatus: 404 });
const now = () => new Date(clock);

async function seed() {
  const { logs, errors, tables, out } = io();
  const code = await runSeedCli([], { openDb: () => db, http: http(), probes: atsProbes, now, pacing: NO_PACING, out });
  return { code, logs, errors, tables };
}

async function fetchAll() {
  const { logs, errors, tables, out } = io();
  const code = await runFetchCli([], {
    openDb: () => db,
    http: http(),
    boardAdapters,
    atsAdapters,
    probes: atsProbes,
    now,
    pacing: NO_PACING,
    out: out as never,
  });
  const boards = tables.find((t) => "filtered" in (t[0] ?? {})) as unknown as SummaryRow[] | undefined;
  const ats = tables.find((t) => "filteredTech" in (t[0] ?? {})) as unknown as AtsSummaryRow[];
  return { code, logs, errors, boards, ats };
}

async function company(argv: string[]) {
  const { logs, errors, tables, out } = io();
  const code = await runCompanyCli(argv, { openDb: () => db, http: http(), probes: atsProbes, now, out });
  return { code, logs, errors, tables };
}

const atsRow = (rows: AtsSummaryRow[], source: string) => rows.find((r) => r.source === source)!;
const days = (n: number) => n * 86_400_000;

beforeAll(() => {
  db = openDb({ url: ":memory:", migrate: true });
  routes = { ...ROUTES };
});

// The steps share one DB and one clock, so they run in order.
describe("M2 end to end, offline", () => {
  it("1. seed loads the seed lists and resolves them", async () => {
    const { code, logs, errors } = await seed();
    expect(code).toBe(0);
    expect(errors).toEqual([]);
    expect(logs).toContain("YC skipped: not active 0, not hiring 0, home country 1");
    expect(db.select().from(companyCandidates).all().map((c) => [c.name, c.origin, c.status, c.ambiguousMatches.map((m) => `${m.ats}/${m.slug}`)])).toEqual([
      ["Acme", "seed:remoteintech", "confirmed", []],
      ["Globex", "seed:remoteintech", "confirmed", []],
      ["Initech", "seed:yc", "ambiguous", ["ashby/initech"]],
    ]);
    expect(db.select().from(companies).all().map((c) => `${c.ats}/${c.slug}`).sort()).toEqual(["greenhouse/acme", "lever/globex"]);
    expect(logs).toContain("Companies: 2 active (greenhouse 1, lever 1)");
  });

  it("2. the first fetch discovers 10 board companies and stores the matching jobs", async () => {
    const { code, errors, boards, ats, logs } = await fetchAll();
    expect(code).toBe(0);
    expect(errors).toEqual([]);
    expect(boards?.map((r) => r.status)).toEqual(Array(7).fill("success"));
    expect(logs).toContain("Resolution: checked 10, confirmed 0, ambiguous 0, not found 10, errors 0");
    expect(atsRow(ats, "greenhouse")).toMatchObject({ status: "success", companies: 1, failed: 0, fetched: 3, inserted: 1, filteredTech: 1, filteredLocation: 1, closed: 0 });
    expect(atsRow(ats, "lever")).toMatchObject({ status: "success", companies: 1, fetched: 2, inserted: 1, filteredTech: 0, filteredLocation: 1, closed: 0 });
    expect(ats.filter((r) => r.status === "skipped").map((r) => r.source)).toEqual(["ashby", "recruitee", "smartrecruiters"]);
    expect(logs).toContain("Open jobs in DB: 2");
    expect(db.select().from(jobs).all().map((j) => j.title).sort()).toEqual(["Backend Developer (Node.js)", "Senior Full-Stack Engineer"]);
  });

  it("3. fetching again right away skips everything", async () => {
    const { code, boards, ats, logs } = await fetchAll();
    expect(code).toBe(0);
    expect(boards?.map((r) => r.status)).toEqual(Array(7).fill("skipped"));
    expect(ats.map((r) => r.status)).toEqual(Array(5).fill("skipped"));
    expect(logs).toContain("Resolution: checked 0, confirmed 0, ambiguous 0, not found 0, errors 0");
    expect(logs).toContain("Open jobs in DB: 2");
  });

  it("4. a job that disappears from its board is closed", async () => {
    clock = T0 + 21 * 3_600_000;
    routes[ACME_JOBS] = "integration/gh-jobs-acme-no-1.json";
    const { ats, logs } = await fetchAll();
    expect(atsRow(ats, "greenhouse")).toMatchObject({ status: "success", fetched: 2, inserted: 0, closed: 1 });
    expect(atsRow(ats, "lever")).toMatchObject({ status: "success", closed: 0 });
    expect(logs).toContain("Open jobs in DB: 1");
    expect(logs).toContain("Compacted 0 closed jobs");
  });

  it("5. a job closed for more than 30 days keeps its row but loses its description", async () => {
    clock = T0 + 21 * 3_600_000 + days(31);
    const { logs } = await fetchAll();
    expect(logs).toContain("Compacted 1 closed jobs");
    const stored = db.select().from(jobs).all();
    expect(stored).toHaveLength(2);
    const closed = stored.find((j) => j.externalId === "acme:1");
    expect(closed).toMatchObject({ descriptionHtml: "", descriptionText: "" });
    expect(closed?.closedAt).not.toBeNull();
  });

  it("6. an ambiguous company can be confirmed by hand and is then fetched", async () => {
    const review = await company(["review"]);
    expect(review.tables[0]).toEqual([
      { id: 3, name: "Initech", origin: "seed:yc", website: "https://initech.com", matches: "ashby/initech" },
    ]);
    const confirm = await company(["confirm", "3", "ashby", "initech"]);
    expect(confirm.code).toBe(0);
    expect(confirm.logs).toEqual(["Confirmed Initech → ashby/initech"]);

    const { ats, logs } = await fetchAll();
    expect(atsRow(ats, "ashby")).toMatchObject({ status: "success", companies: 1, fetched: 1, inserted: 1 });
    expect(logs).toContain("Active companies: 3");
    expect(logs).toContain("Open jobs in DB: 2");
  });
});
