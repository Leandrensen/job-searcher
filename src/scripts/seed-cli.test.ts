import { describe, expect, it, vi } from "vitest";
import { openDb } from "@/db/client";
import { companies, companyCandidates } from "@/db/schema";
import { REMOTEINTECH_RAW_BASE, REMOTEINTECH_TREE_URL, YC_ALL_URL } from "@/companies/seeds";
import { atsProbes } from "@/sources/registry";
import { createFixtureHttp, type FixtureRoute } from "@/test-utils/fixture-http";
import { parseSeedArgs, runSeedCli } from "./seed-cli";

const raw = (p: string) => REMOTEINTECH_RAW_BASE + p;
const gh = (s: string) => `https://boards-api.greenhouse.io/v1/boards/${s}`;
const lever = (s: string) => `https://api.lever.co/v0/postings/${s}?mode=json`;
const ashby = (s: string) => `https://api.ashbyhq.com/posting-api/job-board/${s}?includeCompensation=true`;

const SEED_ROUTES: Record<string, FixtureRoute> = {
  [REMOTEINTECH_TREE_URL]: "seed/tree.json",
  [raw("src/companies/acme.md")]: "seed/acme.md",
  [raw("src/companies/globex.md")]: "seed/globex.md",
  [raw("src/companies/no-title.md")]: "seed/no-title.md",
  [raw("src/companies/broken.md")]: { status: 404 },
  [YC_ALL_URL]: "seed/yc.json",
};
const ATS_ROUTES: Record<string, FixtureRoute> = {
  [gh("acme")]: "resolve/gh-board-something-else.json",
  [`${gh("acme")}/jobs?content=true`]: "resolve/gh-jobs-empty.json",
  [lever("globex")]: "resolve/lever-globex-two.json",
  [ashby("initech")]: "resolve/ashby-initech.json",
};

function setup(routes: Record<string, FixtureRoute> = { ...SEED_ROUTES, ...ATS_ROUTES }) {
  const db = openDb({ url: ":memory:", migrate: true });
  const http = createFixtureHttp(routes, { fallbackStatus: 404 });
  const openDbSpy = vi.fn(() => db);
  const tables: Array<Array<Record<string, string | number>>> = [];
  const logs: string[] = [];
  const errors: string[] = [];
  const run = (argv: string[]) =>
    runSeedCli(argv, {
      openDb: openDbSpy,
      http,
      probes: atsProbes,
      now: () => new Date("2026-11-16T12:00:00.000Z"),
      pacing: { minIntervalMs: 0, perHostMinIntervalMs: {} },
      out: { log: (m) => logs.push(m), error: (m) => errors.push(m), table: (rows) => tables.push(rows) },
    });
  return { db, http, openDbSpy, tables, logs, errors, run };
}

describe("parseSeedArgs", () => {
  it("returns defaults", () => {
    expect(parseSeedArgs([])).toEqual({ limit: undefined, resolve: true, only: undefined });
  });

  it("parses every flag", () => {
    expect(parseSeedArgs(["--limit", "5", "--no-resolve", "--only", "yc"])).toEqual({ limit: 5, resolve: false, only: "yc" });
  });

  it.each([
    [["--bogus"], "Unknown option: --bogus"],
    [["--limit"], "Missing or invalid value for --limit"],
    [["--limit", "0"], "Missing or invalid value for --limit"],
    [["--limit", "abc"], "Missing or invalid value for --limit"],
    [["--only"], "Missing or invalid value for --only (remoteintech or yc)"],
    [["--only", "boards"], "Missing or invalid value for --only (remoteintech or yc)"],
  ])("rejects %j", (argv, message) => {
    expect(() => parseSeedArgs(argv)).toThrow(message);
  });
});

describe("runSeedCli", () => {
  it("loads both sources and resolves the candidates", async () => {
    const { db, tables, logs, errors, run } = setup();
    expect(await run([])).toBe(0);
    expect(errors).toEqual([]);

    expect(tables[0]).toEqual([
      { origin: "seed:remoteintech", inserted: 2, updated: 0, unchanged: 0 },
      { origin: "seed:yc", inserted: 3, updated: 0, unchanged: 0 },
    ]);
    expect(logs).toContain("YC skipped: not active 1, not hiring 1, home country 1");

    expect(tables[1]).toEqual([
      { origin: "seed:remoteintech", checked: 2, confirmed: 2, rate: "100%" },
      { origin: "seed:yc", checked: 3, confirmed: 0, rate: "0%" },
    ]);
    expect(logs).toContain("Companies: 2 active (greenhouse 1, lever 1)");

    const byName = Object.fromEntries(db.select().from(companyCandidates).all().map((c) => [c.name, c.status]));
    expect(byName).toEqual({ Acme: "confirmed", Globex: "confirmed", Initech: "ambiguous", Umbrella: "not_found", "Massive Dynamic": "not_found" });
    // Candidates resolve concurrently, so the insertion order is not fixed.
    expect(db.select().from(companies).all().map((c) => `${c.ats}/${c.slug}`).sort()).toEqual(["greenhouse/acme", "lever/globex"]);
  });

  it("--no-resolve only loads the candidates", async () => {
    const { db, http, tables, logs, run } = setup();
    expect(await run(["--no-resolve"])).toBe(0);
    expect(tables).toHaveLength(1);
    expect(db.select().from(companies).all()).toEqual([]);
    expect(http.calls.some((u) => u.includes("greenhouse") || u.includes("lever"))).toBe(false);
    expect(logs.some((l) => l.startsWith("Companies:"))).toBe(true);
  });

  it("--only yc fetches just the YC dataset", async () => {
    const { http, tables, run } = setup();
    expect(await run(["--only", "yc", "--no-resolve"])).toBe(0);
    expect(http.calls).toEqual([YC_ALL_URL]);
    expect(tables[0]).toEqual([{ origin: "seed:yc", inserted: 3, updated: 0, unchanged: 0 }]);
  });

  it("--only remoteintech fetches just the remoteintech files", async () => {
    const { http, run } = setup();
    await run(["--only", "remoteintech", "--no-resolve"]);
    expect(http.calls).not.toContain(YC_ALL_URL);
    expect(http.calls[0]).toBe(REMOTEINTECH_TREE_URL);
  });

  it("--limit caps how many candidates are resolved", async () => {
    const { tables, run } = setup();
    await run(["--limit", "1"]);
    expect(tables[1]!.reduce((n, r) => n + Number(r.checked), 0)).toBe(1);
  });

  it("running again updates nothing and resolves nothing new", async () => {
    const { tables, run } = setup();
    await run([]);
    await run([]);
    expect(tables[2]).toEqual([
      { origin: "seed:remoteintech", inserted: 0, updated: 0, unchanged: 2 },
      { origin: "seed:yc", inserted: 0, updated: 0, unchanged: 3 },
    ]);
  });

  it("an unknown flag returns 1 without opening the database", async () => {
    const { errors, openDbSpy, run } = setup();
    expect(await run(["--bogus"])).toBe(1);
    expect(errors).toEqual(["Unknown option: --bogus"]);
    expect(openDbSpy).not.toHaveBeenCalled();
  });

  it("a failing source is reported and the other source still loads", async () => {
    const routes = { ...SEED_ROUTES, [REMOTEINTECH_TREE_URL]: { status: 500 } as FixtureRoute };
    const { tables, errors, run } = setup(routes);
    expect(await run(["--no-resolve"])).toBe(0);
    expect(errors).toEqual([expect.stringContaining("remoteintech")]);
    expect(tables[0]).toEqual([{ origin: "seed:yc", inserted: 3, updated: 0, unchanged: 0 }]);
  });

  it("returns 1 when every source fails", async () => {
    const routes = { [REMOTEINTECH_TREE_URL]: { status: 500 }, [YC_ALL_URL]: { status: 500 } } as Record<string, FixtureRoute>;
    const { errors, run } = setup(routes);
    expect(await run([])).toBe(1);
    expect(errors).toHaveLength(2);
  });
});
