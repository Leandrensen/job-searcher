import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError, type HttpClient } from "@/core/http";
import { openDb, type Db } from "@/db/client";
import { listDueCandidates, recordResolution, upsertCandidate } from "@/db/companies";
import { companies, companyCandidates } from "@/db/schema";
import { atsProbes } from "@/sources/registry";
import { createFixtureHttp, type FixtureRoute } from "@/test-utils/fixture-http";
import { resolveCandidate, type Candidate } from "./resolve";
import { resolveDueCandidates } from "./resolve-runner";

const NOW = new Date("2026-11-16T12:00:00.000Z");
const gh = (slug: string) => `https://boards-api.greenhouse.io/v1/boards/${slug}`;
const ghJobs = (slug: string) => `${gh(slug)}/jobs?content=true`;
const ashby = (slug: string) => `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`;

const routes: Record<string, FixtureRoute> = {
  [gh("acme")]: "resolve/gh-board-acme.json",
  [ghJobs("acme")]: "resolve/gh-jobs-empty.json",
  [ashby("initech")]: "resolve/ashby-initech.json",
};

let db: Db;
beforeEach(() => {
  db = openDb({ url: ":memory:", migrate: true });
});

const add = (name: string, origin: string, createdAt = NOW.toISOString()) => upsertCandidate(db, { name, origin }, createdAt);
const rows = () => db.select().from(companyCandidates).all();
const run = (over: Partial<Parameters<typeof resolveDueCandidates>[0]> = {}) =>
  resolveDueCandidates({ db, http: createFixtureHttp(routes, { fallbackStatus: 404 }), probes: atsProbes, now: () => NOW, ...over });

describe("resolveDueCandidates", () => {
  it("resolves due candidates and writes each result", async () => {
    add("Acme Inc", "seed:yc");
    add("Initech", "seed:remoteintech");
    add("Nobody Corp", "board:remoteok");
    const stats = await run();
    expect(stats).toMatchObject({ checked: 3, confirmed: 1, ambiguous: 1, notFound: 1, errors: 0 });
    const byName = Object.fromEntries(rows().map((r) => [r.name, r]));
    expect(byName["Acme Inc"]).toMatchObject({ status: "confirmed", attempts: 1 });
    expect(byName["Initech"]).toMatchObject({ status: "ambiguous", ambiguousMatches: [{ ats: "ashby", slug: "initech" }] });
    expect(byName["Nobody Corp"]).toMatchObject({ status: "not_found" });
    expect(db.select().from(companies).all()).toMatchObject([{ ats: "greenhouse", slug: "acme", name: "Acme Inc", origin: "seed:yc" }]);
  });

  it("counts results by origin", async () => {
    add("Acme Inc", "seed:yc");
    add("Initech", "seed:yc");
    add("Nobody Corp", "board:remoteok");
    const stats = await run();
    expect(stats.byOrigin).toEqual({ "seed:yc": { checked: 2, confirmed: 1 }, "board:remoteok": { checked: 1, confirmed: 0 } });
  });

  it("respects the limit and leaves the rest for the next run", async () => {
    add("Acme Inc", "seed:yc", "2026-11-16T10:00:00.000Z");
    add("Initech", "seed:yc", "2026-11-16T10:01:00.000Z");
    add("Nobody Corp", "seed:yc", "2026-11-16T10:02:00.000Z");
    expect((await run({ limit: 2 })).checked).toBe(2);
    expect(listDueCandidates(db, NOW.toISOString()).map((c) => c.name)).toEqual(["Nobody Corp"]);
    expect((await run()).checked).toBe(1);
  });

  it("skips candidates that are not due", async () => {
    add("Acme Inc", "seed:yc");
    add("Initech", "seed:yc");
    const initech = rows().find((r) => r.name === "Initech")!;
    recordResolution(db, initech.id, { status: "not_found" }, NOW.toISOString()); // next check in 30 days
    const stats = await run();
    expect(stats.checked).toBe(1);
    expect(rows().find((r) => r.name === "Initech")?.attempts).toBe(1);
  });

  it("a thrown candidate becomes an error and the others continue", async () => {
    add("Acme Inc", "seed:yc");
    add("Explodes", "seed:yc");
    add("Initech", "seed:yc");
    const resolve = vi.fn(async (http: Parameters<typeof resolveCandidate>[0], c: Candidate, probes: Parameters<typeof resolveCandidate>[2]) => {
      if (c.name === "Explodes") throw new TypeError("kaboom");
      return resolveCandidate(http, c, probes);
    });
    const stats = await run({ resolve });
    expect(stats).toMatchObject({ checked: 3, confirmed: 1, ambiguous: 1, errors: 1 });
    expect(rows().find((r) => r.name === "Explodes")).toMatchObject({ status: "error", attempts: 1 });
  });

  it("an error result schedules a retry in a day", async () => {
    add("Flaky", "seed:yc");
    const http = createFixtureHttp({ [`https://api.lever.co/v0/postings/flaky?mode=json`]: { status: 500 } }, { fallbackStatus: 404 });
    const stats = await run({ http });
    expect(stats.errors).toBe(1);
    expect(rows()[0]).toMatchObject({ status: "error", nextCheckAt: "2026-11-17T12:00:00.000Z" });
  });

  it("limits how many candidates are in flight", async () => {
    for (const n of ["A One", "B Two", "C Three", "D Four", "E Five"]) add(n, "seed:yc");
    let active = 0;
    let max = 0;
    const resolve = async () => {
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return { status: "not_found" as const };
    };
    await run({ resolve, concurrency: 2 });
    expect(max).toBe(2);
  });

  it("logs progress every 25 candidates", async () => {
    for (let i = 0; i < 26; i++) add(`Company Number ${String.fromCharCode(65 + (i % 26))}${i}`, "seed:yc");
    const log = vi.fn<(m: string) => void>();
    await run({ log, resolve: async () => ({ status: "not_found" }) });
    expect(log).toHaveBeenCalledWith("resolve: 25/26 (confirmed 0, ambiguous 0, not found 25, errors 0)");
  });

  it("does nothing when no candidate is due", async () => {
    expect(await run()).toEqual({ checked: 0, confirmed: 0, ambiguous: 0, notFound: 0, errors: 0, byOrigin: {} });
  });
});

describe("resolveDueCandidates when an ATS rate limits us", () => {
  function rateLimitedWorkable() {
    const calls: string[] = [];
    const fail = async (url: string): Promise<never> => {
      calls.push(url);
      const status = new URL(url).host === "apply.workable.com" ? 429 : 404;
      throw new HttpError(status, url, `HTTP ${status} for ${url}`);
    };
    const client: HttpClient = { getJson: fail, getText: fail };
    return { client, workableCalls: () => calls.filter((u) => new URL(u).host === "apply.workable.com") };
  }

  it("stops probing that ATS for the rest of the run after the first 429", async () => {
    add("Aaa Co", "seed:yc", "2026-11-16T10:00:00.000Z");
    add("Bbb Co", "seed:yc", "2026-11-16T10:01:00.000Z");
    add("Ccc Co", "seed:yc", "2026-11-16T10:02:00.000Z");
    const { client, workableCalls } = rateLimitedWorkable();
    const stats = await run({ http: client, concurrency: 1 });
    expect(workableCalls()).toHaveLength(1);
    // The other ATSs said "not found", but Workable could not answer, so every candidate is retried tomorrow.
    expect(stats).toMatchObject({ checked: 3, confirmed: 0, notFound: 0, errors: 3 });
    expect(rows().map((r) => [r.name, r.status])).toEqual([
      ["Aaa Co", "error"],
      ["Bbb Co", "error"],
      ["Ccc Co", "error"],
    ]);
  });

  it("probes Workable again on the next run", async () => {
    add("Aaa Co", "seed:yc");
    const { client, workableCalls } = rateLimitedWorkable();
    await run({ http: client });
    await run({ http: client, now: () => new Date(NOW.getTime() + 2 * 86_400_000) });
    expect(workableCalls()).toHaveLength(2);
  });
});
