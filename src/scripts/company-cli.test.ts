import { describe, expect, it, vi } from "vitest";
import { openDb } from "@/db/client";
import { addManualCompany, listAmbiguousCandidates, recordResolution, upsertCandidate } from "@/db/companies";
import { companies, companyCandidates } from "@/db/schema";
import { atsProbes } from "@/sources/registry";
import { createFixtureHttp, type FixtureRoute } from "@/test-utils/fixture-http";
import { runCompanyCli } from "./company-cli";

const NOW = "2026-11-16T12:00:00.000Z";
const gh = (s: string) => `https://boards-api.greenhouse.io/v1/boards/${s}`;
const ashby = (s: string) => `https://api.ashbyhq.com/posting-api/job-board/${s}?includeCompensation=true`;

const ROUTES: Record<string, FixtureRoute> = {
  [gh("acme")]: "resolve/gh-board-acme.json",
  [`${gh("acme")}/jobs?content=true`]: "resolve/gh-jobs-empty.json",
  [ashby("initech")]: "resolve/ashby-initech.json",
};

function setup(random: () => number = () => 0) {
  const db = openDb({ url: ":memory:", migrate: true });
  const http = createFixtureHttp(ROUTES, { fallbackStatus: 404 });
  const openDbSpy = vi.fn(() => db);
  const logs: string[] = [];
  const errors: string[] = [];
  const tables: Array<Array<Record<string, string | number>>> = [];
  const run = (argv: string[]) =>
    runCompanyCli(argv, {
      openDb: openDbSpy,
      http,
      probes: atsProbes,
      now: () => new Date(NOW),
      random,
      out: { log: (m) => logs.push(m), error: (m) => errors.push(m), table: (r) => tables.push(r) },
    });
  const ambiguous = (name: string, matches = [{ ats: "ashby", slug: "initech" }]) => {
    upsertCandidate(db, { name, website: `https://${name.toLowerCase()}.example`, origin: "seed:yc" }, NOW);
    const id = db.select().from(companyCandidates).all().find((c) => c.name === name)!.id;
    recordResolution(db, id, { status: "ambiguous", matches: matches as never }, NOW);
    return id;
  };
  return { db, http, openDbSpy, logs, errors, tables, run, ambiguous };
}

describe("company add", () => {
  it("confirms the company and links its candidate", async () => {
    const { db, logs, run } = setup();
    expect(await run(["add", "greenhouse", "acme", "--country", "US"])).toBe(0);
    expect(logs).toEqual(["Added greenhouse/acme (ACME)"]);
    const company = db.select().from(companies).get()!;
    expect(company).toMatchObject({ ats: "greenhouse", slug: "acme", name: "ACME", homeCountry: "US", origin: "manual", status: "active" });
    expect(db.select().from(companyCandidates).get()).toMatchObject({ name: "ACME", status: "confirmed", companyId: company.id });
  });

  it("uses --name over the name the ATS reports", async () => {
    const { db, logs, run } = setup();
    await run(["add", "greenhouse", "acme", "--name", "Acme Corporation"]);
    expect(logs).toEqual(["Added greenhouse/acme (Acme Corporation)"]);
    expect(db.select().from(companies).get()?.name).toBe("Acme Corporation");
  });

  it("falls back to the slug when no name is available", async () => {
    const { logs, run } = setup();
    expect(await run(["add", "ashby", "initech"])).toBe(0);
    expect(logs).toEqual(["Added ashby/initech (initech)"]);
  });

  it("reactivates a company that went inactive", async () => {
    const { db, run } = setup();
    const { companyId } = addManualCompany(db, { ats: "greenhouse", slug: "acme", name: "Old", homeCountry: null }, NOW);
    db.update(companies).set({ status: "inactive", consecutiveFailures: 3 }).run();
    expect(await run(["add", "greenhouse", "acme"])).toBe(0);
    expect(db.select().from(companies).all()).toMatchObject([{ id: companyId, status: "active", consecutiveFailures: 0 }]);
  });

  it("an unknown board returns 1", async () => {
    const { errors, db, run } = setup();
    expect(await run(["add", "greenhouse", "nope"])).toBe(1);
    expect(errors).toEqual(["No greenhouse board found for nope"]);
    expect(db.select().from(companies).all()).toEqual([]);
  });

  it.each([
    [["add", "workday", "acme"], "Unknown ATS: workday. Valid: greenhouse, lever, ashby, recruitee, smartrecruiters"],
    [["add", "greenhouse", "acme", "--country", "usa"], "Invalid --country: usa (use a 2-letter ISO code like US)"],
    [["add", "greenhouse"], "Usage:"],
    [["add", "greenhouse", "acme", "--bogus"], "Unknown option: --bogus"],
  ])("rejects bad arguments %j", async (argv, message) => {
    const { errors, openDbSpy, run } = setup();
    expect(await run(argv)).toBe(1);
    expect(errors[0]).toContain(message);
    expect(openDbSpy).not.toHaveBeenCalled();
  });
});

describe("company review", () => {
  it("lists ambiguous candidates", async () => {
    const { tables, run, ambiguous } = setup();
    const id = ambiguous("Initech", [{ ats: "ashby", slug: "initech" }, { ats: "lever", slug: "initech" }]);
    expect(await run(["review"])).toBe(0);
    expect(tables[0]).toEqual([
      { id, name: "Initech", origin: "seed:yc", website: "https://initech.example", matches: "ashby/initech, lever/initech" },
    ]);
  });

  it("says so when nothing is ambiguous", async () => {
    const { logs, tables, run } = setup();
    expect(await run(["review"])).toBe(0);
    expect(logs).toEqual(["No ambiguous companies."]);
    expect(tables).toEqual([]);
  });
});

describe("company confirm", () => {
  it("confirms an ambiguous candidate against an ATS board that exists", async () => {
    const { db, logs, run, ambiguous } = setup();
    const id = ambiguous("Initech");
    expect(await run(["confirm", String(id), "ashby", "initech"])).toBe(0);
    expect(logs).toEqual(["Confirmed Initech → ashby/initech"]);
    expect(db.select().from(companies).get()).toMatchObject({ ats: "ashby", slug: "initech", name: "Initech", origin: "seed:yc", status: "active" });
    expect(listAmbiguousCandidates(db)).toEqual([]);
  });

  it("refuses a candidate that is not ambiguous", async () => {
    const { db, errors, run } = setup();
    upsertCandidate(db, { name: "Pending Co", origin: "seed:yc" }, NOW);
    const id = db.select().from(companyCandidates).get()!.id;
    expect(await run(["confirm", String(id), "ashby", "initech"])).toBe(1);
    expect(errors).toEqual([`Candidate ${id} is not ambiguous`]);
  });

  it("refuses an unknown candidate and a missing board", async () => {
    const { errors, run, ambiguous } = setup();
    expect(await run(["confirm", "999", "ashby", "initech"])).toBe(1);
    expect(errors[0]).toBe("No candidate with id 999");
    const id = ambiguous("Initech");
    expect(await run(["confirm", String(id), "lever", "nope"])).toBe(1);
    expect(errors[1]).toBe("No lever board found for nope");
  });
});

describe("company reject", () => {
  it("marks an ambiguous candidate rejected for good", async () => {
    const { db, logs, run, ambiguous } = setup();
    const id = ambiguous("Initech");
    expect(await run(["reject", String(id)])).toBe(0);
    expect(logs).toEqual(["Rejected Initech"]);
    expect(db.select().from(companyCandidates).get()).toMatchObject({ status: "rejected", nextCheckAt: null, ambiguousMatches: [] });
  });

  it("refuses a candidate that is not ambiguous", async () => {
    const { db, errors, run } = setup();
    upsertCandidate(db, { name: "Pending Co", origin: "seed:yc" }, NOW);
    const id = db.select().from(companyCandidates).get()!.id;
    expect(await run(["reject", String(id)])).toBe(1);
    expect(errors).toEqual([`Candidate ${id} is not ambiguous`]);
  });
});

describe("company sample", () => {
  const seed = (db: ReturnType<typeof setup>["db"]) => {
    const add = (ats: "greenhouse" | "lever" | "recruitee" | "smartrecruiters", slug: string, name: string) =>
      addManualCompany(db, { ats, slug, name, homeCountry: null }, NOW);
    add("greenhouse", "acme", "Acme");
    add("lever", "globex", "Globex");
    add("recruitee", "tether", "Tether");
    add("smartrecruiters", "BoschGroup", "Bosch Group");
  };

  it("prints n active companies with their board urls", async () => {
    const { db, logs, run } = setup(() => 0);
    seed(db);
    expect(await run(["sample", "2"])).toBe(0);
    expect(logs).toHaveLength(2);
    for (const line of logs) expect(line).toMatch(/^.+ \| (greenhouse|lever|recruitee|smartrecruiters) \| .+ \| https:\/\/.+$/);
  });

  it("prints every company when n is larger than the list, one per line", async () => {
    const { db, logs, run } = setup();
    seed(db);
    await run(["sample", "10"]);
    expect([...logs].sort()).toEqual([
      "Acme | greenhouse | acme | https://boards.greenhouse.io/acme",
      "Bosch Group | smartrecruiters | BoschGroup | https://jobs.smartrecruiters.com/BoschGroup",
      "Globex | lever | globex | https://jobs.lever.co/globex",
      "Tether | recruitee | tether | https://tether.recruitee.com",
    ]);
  });

  it("picks different companies for different random numbers", async () => {
    const a = setup(() => 0);
    seed(a.db);
    await a.run(["sample", "1"]);
    const b = setup(() => 0.99);
    seed(b.db);
    await b.run(["sample", "1"]);
    expect(a.logs[0]).not.toBe(b.logs[0]);
  });

  it("says so when there are no companies", async () => {
    const { logs, run } = setup();
    await run(["sample", "5"]);
    expect(logs).toEqual(["No active companies."]);
  });

  it.each([[["sample"]], [["sample", "0"]], [["sample", "abc"]]])("rejects %j", async (argv) => {
    const { errors, run } = setup();
    expect(await run(argv)).toBe(1);
    expect(errors[0]).toContain("Usage:");
  });
});

describe("usage", () => {
  it.each([[[]], [["bogus"]]])("returns 1 with the usage line for %j", async (argv) => {
    const { errors, openDbSpy, run } = setup();
    expect(await run(argv)).toBe(1);
    expect(errors[0]).toContain("Usage: company add <ats> <slug>");
    expect(openDbSpy).not.toHaveBeenCalled();
  });
});
