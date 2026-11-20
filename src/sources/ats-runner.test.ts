import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { HttpError, type HttpClient } from "@/core/http";
import { ATS_IDS, type AtsId, type Job, type WorkplaceType } from "@/core/job";
import { openDb, type Db } from "@/db/client";
import { insertOrGetCompany, recordResolution, upsertCandidate } from "@/db/companies";
import { countJobs } from "@/db/queries";
import { companies, companyCandidates, fetchRuns, jobs } from "@/db/schema";
import { createFixtureHttp } from "@/test-utils/fixture-http";
import { keywordRules } from "@/test-utils/job-filter-rules";
import { greenhouse } from "./ats/greenhouse";
import { CompanyRefSchema } from "./ats/shared";
import { runAtsSources } from "./ats-runner";
import { defineAdapter, type AnyAdapter } from "./types";

const T0 = new Date("2026-11-16T12:00:00.000Z");
const hoursLater = (h: number) => new Date(T0.getTime() + h * 3_600_000);

type FakeItem = { id: string; title: string; workplaceType?: WorkplaceType | null; regions?: string[] };
type Board = FakeItem[] | Error | "404";

/** A fake ATS adapter whose boards (slug -> items, an error, or "404") can be changed between runs. */
function fakeAts(id: AtsId, boards: Record<string, Board>) {
  const ItemSchema = z.object({
    company: CompanyRefSchema,
    item: z.object({ id: z.string(), title: z.string(), workplaceType: z.enum(["remote", "hybrid", "onsite"]).nullish(), regions: z.array(z.string()).default([]) }),
  });
  const adapter = defineAdapter<z.infer<typeof ItemSchema>>({
    id,
    name: id,
    homepage: "https://example.com",
    minIntervalMinutes: 0,
    techFilter: false,
    itemSchema: ItemSchema,
    async fetch(ctx) {
      const out: unknown[] = [];
      for (const company of ctx.companies ?? []) {
        const board = boards[company.slug];
        if (board === "404") throw new HttpError(404, `https://x/${company.slug}`, `HTTP 404 for https://x/${company.slug}`);
        if (board instanceof Error) throw board;
        for (const item of board ?? []) out.push({ company, item });
      }
      return out;
    },
    normalize: ({ company, item }): Job => ({
      source: id,
      externalId: `${company.slug}:${item.id}`,
      url: `https://example.com/${company.slug}/${item.id}`,
      applyUrl: null,
      title: item.title,
      company: company.name,
      location: null,
      workplaceType: item.workplaceType === undefined ? "remote" : item.workplaceType,
      departments: [],
      regions: item.regions ?? [],
      employmentType: null,
      tags: [],
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      descriptionHtml: "",
      descriptionText: "",
      postedAt: null,
    }),
  });
  return { adapter, boards };
}

const GOOD: FakeItem[] = [
  { id: "1", title: "Senior Full-Stack Engineer", regions: ["latam"] }, // stored
  { id: "2", title: "Account Executive" }, // dropped by the tech filter
  { id: "3", title: "Frontend Engineer", workplaceType: "onsite" }, // dropped by the location filter (onsite)
  { id: "4", title: "Backend Engineer", regions: ["europe"] }, // dropped by the location filter (region)
  { id: "5", title: "Node Developer" }, // stored: no region at all passes
];

let db: Db;
let http: HttpClient;
beforeEach(() => {
  db = openDb({ url: ":memory:", migrate: true });
  http = { getJson: vi.fn(), getText: vi.fn() };
});

const addCompany = (ats: AtsId, slug: string, homeCountry: string | null = "US") =>
  insertOrGetCompany(db, { ats, slug, name: slug.toUpperCase(), website: null, homeCountry, origin: "manual" }, T0.toISOString());
const run = (
  adapters: AnyAdapter[],
  over: { force?: boolean; at?: Date; log?: (m: string) => void; rules?: Parameters<typeof runAtsSources>[0]["rules"] } = {},
) => runAtsSources({ db, http, adapters, force: over.force, now: () => over.at ?? T0, log: over.log ?? (() => {}), rules: over.rules });
const company = (slug: string) => db.select().from(companies).all().find((c) => c.slug === slug)!;

describe("runAtsSources", () => {
  it("stores only jobs passing both filters, with their companyId", async () => {
    const id = addCompany("greenhouse", "acme");
    const { adapter } = fakeAts("greenhouse", { acme: GOOD });
    const [summary] = await run([adapter]);
    expect(summary).toMatchObject({
      source: "greenhouse",
      status: "success",
      companies: 1,
      companiesFailed: 0,
      fetched: 5,
      inserted: 2,
      updated: 0,
      invalid: 0,
      filteredRules: 1,
      filteredLocation: 2,
      closed: 0,
      error: null,
    });
    const stored = db.select().from(jobs).all();
    expect(stored.map((j) => j.externalId).sort()).toEqual(["acme:1", "acme:5"]);
    expect(stored.every((j) => j.companyId === id && j.closedAt === null)).toBe(true);
  });

  it("does not fetch a company based outside the allowed countries", async () => {
    addCompany("greenhouse", "argentinian", "AR");
    const { adapter } = fakeAts("greenhouse", { argentinian: GOOD });
    const log = vi.fn<(m: string) => void>();
    const [summary] = await run([adapter], { log });
    expect(summary).toMatchObject({ status: "skipped", companies: 0, inserted: 0 });
    expect(log).toHaveBeenCalledWith("greenhouse: skipped 1 companies based outside the allowed countries");
    expect(company("argentinian").lastFetchedAt).toBeNull();
  });

  it("a company with an unknown home country is fetched", async () => {
    addCompany("greenhouse", "nowhere", null);
    const { adapter } = fakeAts("greenhouse", { nowhere: GOOD });
    expect((await run([adapter]))[0]).toMatchObject({ status: "success", companies: 1, inserted: 2 });
  });

  it("allowed companies are still fetched next to a skipped one", async () => {
    addCompany("greenhouse", "acme");
    addCompany("greenhouse", "argentinian", "AR");
    const { adapter } = fakeAts("greenhouse", { acme: GOOD, argentinian: GOOD });
    expect((await run([adapter]))[0]).toMatchObject({ status: "success", companies: 1, inserted: 2 });
  });

  it("closes jobs missing from the next fetch", async () => {
    const id = addCompany("greenhouse", "acme");
    const { adapter, boards } = fakeAts("greenhouse", { acme: GOOD });
    await run([adapter]);
    boards.acme = [GOOD[0]!, GOOD[1]!]; // job 5 disappeared
    const [second] = await run([adapter], { at: hoursLater(21) });
    expect(second).toMatchObject({ status: "success", inserted: 0, updated: 1, closed: 1 });
    expect(db.select().from(jobs).all().map((j) => [j.externalId, j.closedAt])).toEqual([
      ["acme:1", null],
      ["acme:5", hoursLater(21).toISOString()],
    ]);
    expect(countJobs(db, { openOnly: true })).toBe(1);
    // A job that comes back is reopened.
    boards.acme = GOOD;
    await run([adapter], { at: hoursLater(42) });
    expect(countJobs(db, { openOnly: true })).toBe(2);
    expect(company("acme").id).toBe(id);
  });

  it("three 404s deactivate the company and reopen its candidate", async () => {
    upsertCandidate(db, { name: "Gone Inc", origin: "seed:yc" }, T0.toISOString());
    const candidateId = db.select().from(companyCandidates).get()!.id;
    const { companyId } = recordResolution(db, candidateId, { status: "confirmed", ats: "lever", slug: "gone", companyName: null }, T0.toISOString());
    const { adapter } = fakeAts("lever", { gone: "404" });

    for (let day = 0; day < 3; day++) {
      const [summary] = await run([adapter], { at: hoursLater(day * 24) });
      expect(summary).toMatchObject({ status: "error", companies: 1, companiesFailed: 1 });
      expect(summary?.error).toContain("HTTP 404");
    }
    expect(company("gone")).toMatchObject({ id: companyId, status: "inactive", consecutiveFailures: 3 });
    expect(db.select().from(companyCandidates).get()).toMatchObject({ status: "pending", companyId: null });
    expect((await run([adapter], { at: hoursLater(100) }))[0]?.status).toBe("skipped");
  });

  it("an error that only looks like a 404 is a plain error", async () => {
    addCompany("ashby", "acme");
    const lookalike = Object.assign(new Error("HTTP 404 for https://x/acme"), { name: "HttpError" });
    const { adapter } = fakeAts("ashby", { acme: lookalike });
    await run([adapter]);
    expect(company("acme")).toMatchObject({ consecutiveFailures: 0, status: "active", lastError: "HttpError: HTTP 404 for https://x/acme" });
  });

  it("a non-404 error waits a day and keeps the failure count", async () => {
    addCompany("ashby", "flaky");
    const { adapter, boards } = fakeAts("ashby", { flaky: new Error("HTTP 503") });
    const [first] = await run([adapter]);
    expect(first).toMatchObject({ status: "error", companiesFailed: 1 });
    expect(company("flaky")).toMatchObject({ consecutiveFailures: 0, lastFetchedAt: T0.toISOString(), status: "active" });
    boards.flaky = GOOD;
    expect((await run([adapter], { at: hoursLater(1) }))[0]?.status).toBe("skipped");
    const [later] = await run([adapter], { at: hoursLater(21) });
    expect(later).toMatchObject({ status: "success", inserted: 2 });
  });

  it("three runs in one day count a 404 only once", async () => {
    addCompany("lever", "gone");
    const { adapter } = fakeAts("lever", { gone: "404" });
    const statuses: string[] = [];
    for (const at of [T0, hoursLater(1), hoursLater(2)]) statuses.push((await run([adapter], { at }))[0]!.status);
    expect(statuses).toEqual(["error", "skipped", "skipped"]);
    expect(company("gone")).toMatchObject({ consecutiveFailures: 1, status: "active" });
  });

  it("a failed fetch never closes the company's jobs", async () => {
    addCompany("greenhouse", "acme");
    const { adapter, boards } = fakeAts("greenhouse", { acme: GOOD });
    await run([adapter]);
    boards.acme = new Error("network down");
    await run([adapter], { force: true });
    boards.acme = "404";
    await run([adapter], { force: true });
    expect(countJobs(db, { openOnly: true })).toBe(2);
  });

  it("invalid items stop the run from closing jobs", async () => {
    addCompany("greenhouse", "acme");
    const { adapter, boards } = fakeAts("greenhouse", { acme: GOOD });
    await run([adapter]);
    boards.acme = [GOOD[0]!, { id: "9" } as never]; // the second item has no title, so it is invalid
    const log = vi.fn<(m: string) => void>();
    const [summary] = await run([adapter], { at: hoursLater(21), log });
    expect(summary).toMatchObject({ status: "success", invalid: 1, closed: 0 });
    expect(countJobs(db, { openOnly: true })).toBe(2);
    expect(log).toHaveBeenCalledWith("greenhouse/acme: 1 invalid items, no jobs closed this run");

    // A clean fetch closes the vanished job again.
    boards.acme = [GOOD[0]!];
    const [clean] = await run([adapter], { at: hoursLater(42) });
    expect(clean).toMatchObject({ invalid: 0, closed: 1 });
    expect(countJobs(db, { openOnly: true })).toBe(1);
  });

  it("applies the hard rules and closes jobs that stop passing", async () => {
    addCompany("greenhouse", "acme");
    const { adapter } = fakeAts("greenhouse", { acme: GOOD });
    const keywords = keywordRules().keywords;
    expect((await run([adapter], { rules: { keywords } }))[0]).toMatchObject({ inserted: 2 });
    const [second] = await run([adapter], { at: hoursLater(21), rules: { keywords, excludeTitleKeywords: ["Node"] } });
    expect(second).toMatchObject({ filteredRules: 2, closed: 1 });
    expect(countJobs(db, { openOnly: true })).toBe(1);
  });

  it("an empty board closes all of the company's open jobs", async () => {
    addCompany("greenhouse", "acme");
    const { adapter, boards } = fakeAts("greenhouse", { acme: GOOD });
    await run([adapter]);
    boards.acme = [];
    const [summary] = await run([adapter], { force: true });
    expect(summary).toMatchObject({ status: "success", fetched: 0, closed: 2 });
  });

  it("skips an ATS with no due companies and records the skip", async () => {
    const { adapter } = fakeAts("recruitee", {});
    const [summary] = await run([adapter]);
    expect(summary).toMatchObject({ source: "recruitee", status: "skipped", companies: 0, error: null });
    expect(db.select().from(fetchRuns).all()).toMatchObject([{ source: "recruitee", status: "skipped" }]);
  });

  it("a company fetched today is skipped, and force fetches it again", async () => {
    addCompany("greenhouse", "acme");
    const { adapter } = fakeAts("greenhouse", { acme: GOOD });
    await run([adapter]);
    expect((await run([adapter], { at: hoursLater(5) }))[0]?.status).toBe("skipped");
    expect((await run([adapter], { at: hoursLater(5), force: true }))[0]).toMatchObject({ status: "success", companies: 1 });
    expect((await run([adapter], { at: hoursLater(30) }))[0]).toMatchObject({ status: "success", companies: 1 });
  });

  it("one ATS failing does not stop the others", async () => {
    addCompany("greenhouse", "acme");
    addCompany("lever", "globex");
    const broken = fakeAts("greenhouse", { acme: new Error("boom") });
    const healthy = fakeAts("lever", { globex: GOOD });
    const summaries = await run([broken.adapter, healthy.adapter]);
    expect(summaries.map((s) => [s.source, s.status])).toEqual([["greenhouse", "error"], ["lever", "success"]]);
    expect(summaries[0]?.error).toBe("Error: boom");
    expect(countJobs(db, { source: "lever" })).toBe(2);
  });

  it("a database failure for one company does not stop the next company of the same ATS", async () => {
    addCompany("greenhouse", "a");
    addCompany("greenhouse", "b");
    db.run(sql`CREATE TRIGGER fail_a BEFORE INSERT ON jobs WHEN NEW.external_id LIKE 'a:%' BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;`);
    const { adapter } = fakeAts("greenhouse", { a: GOOD, b: GOOD });
    const [summary] = await run([adapter]);
    expect(summary).toMatchObject({ status: "success", companies: 2, companiesFailed: 1, inserted: 2 });
    expect(company("a")).toMatchObject({ lastFetchedAt: T0.toISOString(), lastError: "SqliteError: simulated write failure" });
    expect(company("b").lastFetchedAt).toBe(T0.toISOString());
  });

  it("never rejects, even when recording the run fails", async () => {
    addCompany("greenhouse", "acme");
    db.run(sql`CREATE TRIGGER fail_runs BEFORE INSERT ON fetch_runs BEGIN SELECT RAISE(ABORT, 'runs table locked'); END;`);
    const { adapter } = fakeAts("greenhouse", { acme: GOOD });
    const log = vi.fn<(m: string) => void>();
    const [summary] = await run([adapter], { log });
    expect(summary).toMatchObject({ source: "greenhouse", status: "error", error: "SqliteError: runs table locked" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("could not record run"));
  });

  it("records one run per ATS with the filtered counts added up", async () => {
    addCompany("greenhouse", "acme");
    const { adapter } = fakeAts("greenhouse", { acme: GOOD });
    await run([adapter]);
    expect(db.select().from(fetchRuns).all()).toMatchObject([
      { source: "greenhouse", status: "success", fetched: 5, inserted: 2, updated: 0, invalid: 0, filtered: 3, error: null },
    ]);
  });

  it("logs one line per company", async () => {
    addCompany("greenhouse", "acme");
    addCompany("greenhouse", "gone");
    const { adapter } = fakeAts("greenhouse", { acme: GOOD, gone: "404" });
    const log = vi.fn<(m: string) => void>();
    await run([adapter], { log });
    expect(log).toHaveBeenCalledWith("greenhouse/acme: kept 2, filtered 1+2, closed 0");
    expect(log).toHaveBeenCalledWith("greenhouse/gone: HttpError: HTTP 404 for https://x/gone");
  });

  it("companies of different ATSs are fetched by their own adapter only", async () => {
    addCompany("greenhouse", "acme");
    addCompany("lever", "acme");
    const gh = fakeAts("greenhouse", { acme: [GOOD[0]!] });
    const lv = fakeAts("lever", { acme: [GOOD[4]!] });
    await run([gh.adapter, lv.adapter]);
    expect(db.select().from(jobs).all().map((j) => `${j.source}/${j.externalId}`).sort()).toEqual(["greenhouse/acme:1", "lever/acme:5"]);
  });

  it("stops fetching an ATS that answers 429 and leaves its companies due", async () => {
    addCompany("recruitee", "a");
    addCompany("recruitee", "b");
    addCompany("recruitee", "c");
    let laterFetches = 0;
    const boards: Record<string, Board> = { a: new HttpError(429, "https://x/a", "HTTP 429 for https://x/a") };
    for (const slug of ["b", "c"]) {
      Object.defineProperty(boards, slug, {
        get() {
          laterFetches++;
          return GOOD;
        },
      });
    }
    const { adapter } = fakeAts("recruitee", boards);
    const log = vi.fn<(m: string) => void>();
    const [summary] = await run([adapter], { log });
    expect(laterFetches).toBe(0);
    expect(summary).toMatchObject({ status: "error", companies: 3, companiesFailed: 3, inserted: 0 });
    expect(summary?.error).toBe("HttpError: HTTP 429 for https://x/a");
    expect(log).toHaveBeenCalledWith("recruitee: rate limited, skipping the other 2 companies until the next run");
    // Nothing was recorded for any company, so all three are still due and none moves toward deactivation.
    expect(db.select().from(companies).all().map((c) => [c.slug, c.lastFetchedAt, c.consecutiveFailures, c.status])).toEqual([
      ["a", null, 0, "active"],
      ["b", null, 0, "active"],
      ["c", null, 0, "active"],
    ]);
  });

  it("only handles ATS adapters", () => {
    expect(ATS_IDS).toContain("greenhouse");
  });
});

describe("runAtsSources with the real Greenhouse adapter and a fixture", () => {
  it("fetches, filters and records a real board", async () => {
    addCompany("greenhouse", "mozilla", "US");
    const fixtureHttp = createFixtureHttp({ "https://boards-api.greenhouse.io/v1/boards/mozilla/jobs?content=true": "ats/greenhouse/jobs.json" });
    const [summary] = await runAtsSources({ db, http: fixtureHttp, adapters: [greenhouse], now: () => T0, log: () => {} });
    // All 3 recorded Mozilla jobs are remote, but only in Europe or North America; two are not tech roles.
    expect(summary).toMatchObject({
      status: "success",
      companies: 1,
      fetched: 3,
      invalid: 0,
      filteredRules: 2,
      filteredLocation: 1,
      inserted: 0,
      closed: 0,
    });
    expect(company("mozilla").lastFetchedAt).toBe(T0.toISOString());
  });
});
