import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "./client";
import {
  addManualCompany,
  companyCounts,
  findCandidateByName,
  getCandidate,
  listActiveCompanies,
  insertOrGetCompany,
  listAmbiguousCandidates,
  listDueCandidates,
  listDueCompanies,
  recordCompanyFetch,
  recordResolution,
  rejectCandidate,
  upsertCandidate,
} from "./companies";
import type { Job } from "@/core/job";
import { upsertJobs } from "./queries";
import { companies, companyCandidates, jobs } from "./schema";

const T0 = "2026-11-16T12:00:00.000Z";
const plusDays = (iso: string, d: number) => new Date(Date.parse(iso) + d * 86_400_000).toISOString();
const plusHours = (iso: string, h: number) => new Date(Date.parse(iso) + h * 3_600_000).toISOString();

let db: Db;
beforeEach(() => {
  db = openDb({ url: ":memory:", migrate: true });
});

const candidates = () => db.select().from(companyCandidates).all();
const allCompanies = () => db.select().from(companies).all();

describe("upsertCandidate", () => {
  it("inserts a new candidate as pending", () => {
    expect(upsertCandidate(db, { name: "Acme Inc", website: "https://acme.io", origin: "seed:yc", homeCountry: "US" }, T0)).toBe("inserted");
    expect(candidates()).toMatchObject([
      { normalizedName: "acme", name: "Acme Inc", website: "https://acme.io", status: "pending", nextCheckAt: null, attempts: 0, homeCountry: "US" },
    ]);
  });

  it("ignores empty names", () => {
    expect(upsertCandidate(db, { name: "  ", origin: "manual" }, T0)).toBe("unchanged");
    expect(candidates()).toHaveLength(0);
  });

  it("merges by normalized name and fills only missing fields", () => {
    upsertCandidate(db, { name: "Acme Inc", website: "https://acme.io", origin: "seed:yc" }, T0);
    const result = upsertCandidate(db, { name: "ACME, Inc.", website: "https://other.com", careersUrl: "https://acme.io/careers", homeCountry: "US", origin: "board:remoteok" }, T0);
    expect(result).toBe("updated");
    expect(candidates()).toHaveLength(1);
    expect(candidates()[0]).toMatchObject({
      name: "Acme Inc",
      website: "https://acme.io",
      careersUrl: "https://acme.io/careers",
      homeCountry: "US",
      origin: "seed:yc",
    });
    expect(upsertCandidate(db, { name: "Acme", origin: "manual" }, T0)).toBe("unchanged");
  });

  it("unions ats hints, keeping order", () => {
    upsertCandidate(db, { name: "Acme", atsHints: ["https://boards.greenhouse.io/acme"], origin: "board:remoteok" }, T0);
    upsertCandidate(db, { name: "Acme", atsHints: ["https://boards.greenhouse.io/acme", "https://jobs.lever.co/acme"], origin: "board:jobicy" }, T0);
    expect(candidates()[0]?.atsHints).toEqual(["https://boards.greenhouse.io/acme", "https://jobs.lever.co/acme"]);
  });

  it("a new hint re-opens a not_found candidate", () => {
    const id = (upsertCandidate(db, { name: "Acme", origin: "seed:yc" }, T0), candidates()[0]!.id);
    recordResolution(db, id, { status: "not_found" }, T0);
    expect(candidates()[0]).toMatchObject({ status: "not_found" });
    expect(upsertCandidate(db, { name: "Acme", website: "https://acme.io", origin: "seed:yc" }, T0)).toBe("updated");
    expect(candidates()[0]).toMatchObject({ status: "not_found" }); // a new website is not a hint
    upsertCandidate(db, { name: "Acme", atsHints: ["https://jobs.lever.co/acme"], origin: "board:remoteok" }, T0);
    expect(candidates()[0]).toMatchObject({ status: "pending", nextCheckAt: null });
  });

  it("a new hint re-opens an ambiguous candidate", () => {
    const id = (upsertCandidate(db, { name: "Acme", origin: "seed:yc" }, T0), candidates()[0]!.id);
    recordResolution(db, id, { status: "ambiguous", matches: [{ ats: "lever", slug: "acme-labs" }] }, T0);
    upsertCandidate(db, { name: "Acme", atsHints: ["https://jobs.lever.co/acme"], origin: "board:remoteok" }, T0);
    expect(candidates()[0]).toMatchObject({ status: "pending", nextCheckAt: null, ambiguousMatches: [] });
    expect(listDueCandidates(db, T0).map((c) => c.id)).toEqual([id]);
  });

  it("a new hint does not reopen a confirmed candidate", () => {
    const id = (upsertCandidate(db, { name: "Acme", origin: "seed:yc" }, T0), candidates()[0]!.id);
    recordResolution(db, id, { status: "confirmed", ats: "greenhouse", slug: "acme", companyName: null }, T0);
    upsertCandidate(db, { name: "Acme", atsHints: ["https://jobs.lever.co/acme"], origin: "board:remoteok" }, T0);
    expect(candidates()[0]).toMatchObject({ status: "confirmed", atsHints: ["https://jobs.lever.co/acme"] });
  });

  it("the same hint again changes nothing", () => {
    const id = (upsertCandidate(db, { name: "Acme", atsHints: ["https://jobs.lever.co/acme"], origin: "seed:yc" }, T0), candidates()[0]!.id);
    recordResolution(db, id, { status: "ambiguous", matches: [{ ats: "lever", slug: "acme-labs" }] }, T0);
    expect(upsertCandidate(db, { name: "Acme", atsHints: ["https://jobs.lever.co/acme"], origin: "board:remoteok" }, T0)).toBe("unchanged");
    expect(candidates()[0]).toMatchObject({ status: "ambiguous", ambiguousMatches: [{ ats: "lever", slug: "acme-labs" }] });
  });
});

describe("rejectCandidate", () => {
  const ambiguousCandidate = () => {
    const id = (upsertCandidate(db, { name: "Acme", origin: "seed:yc" }, T0), candidates()[0]!.id);
    recordResolution(db, id, { status: "ambiguous", matches: [{ ats: "lever", slug: "acme-labs" }] }, T0);
    return id;
  };

  it("makes a candidate permanently not due", () => {
    const id = ambiguousCandidate();
    rejectCandidate(db, id, plusDays(T0, 1));
    expect(candidates()[0]).toMatchObject({ status: "rejected", nextCheckAt: null, ambiguousMatches: [], lastCheckedAt: plusDays(T0, 1) });
    expect(listDueCandidates(db, plusDays(T0, 400))).toEqual([]);
  });

  it("a new hint does not reopen a rejected candidate", () => {
    rejectCandidate(db, ambiguousCandidate(), T0);
    upsertCandidate(db, { name: "Acme", atsHints: ["https://jobs.lever.co/acme"], origin: "board:remoteok" }, T0);
    expect(candidates()[0]).toMatchObject({ status: "rejected", atsHints: ["https://jobs.lever.co/acme"] });
  });

  it("throws for an unknown candidate", () => {
    expect(() => rejectCandidate(db, 999, T0)).toThrow("Unknown candidate 999");
  });
});

describe("listDueCandidates", () => {
  it("includes pending and expired not_found/error only", () => {
    for (const n of ["Pending Co", "Notfound Soon", "Notfound Due", "Error Due", "Confirmed Co", "Ambiguous Co"]) {
      upsertCandidate(db, { name: n, origin: "seed:yc" }, T0);
    }
    const byName = (n: string) => candidates().find((c) => c.name === n)!.id;
    recordResolution(db, byName("Notfound Soon"), { status: "not_found" }, plusDays(T0, 1)); // due T0 + 31 days
    recordResolution(db, byName("Notfound Due"), { status: "not_found" }, plusDays(T0, -40)); // due T0 - 10 days
    recordResolution(db, byName("Error Due"), { status: "error", error: "x" }, plusDays(T0, -2)); // due T0 - 1 day
    recordResolution(db, byName("Confirmed Co"), { status: "confirmed", ats: "lever", slug: "confirmed", companyName: null }, T0);
    recordResolution(db, byName("Ambiguous Co"), { status: "ambiguous", matches: [{ ats: "lever", slug: "x" }] }, T0);
    expect(listDueCandidates(db, T0).map((c) => c.name)).toEqual(["Pending Co", "Notfound Due", "Error Due"]);
    expect(listDueCandidates(db, T0, 2)).toHaveLength(2);
  });
});

describe("recordResolution", () => {
  const seed = (name = "Acme") => {
    upsertCandidate(db, { name, website: "https://acme.io", homeCountry: "US", origin: "seed:yc" }, T0);
    return candidates().find((c) => c.name === name)!.id;
  };

  it("confirmed resolution creates a company and links it", () => {
    const id = seed();
    const { companyId } = recordResolution(db, id, { status: "confirmed", ats: "greenhouse", slug: "acme", companyName: "Acme" }, T0);
    expect(companyId).not.toBeNull();
    expect(allCompanies()).toMatchObject([
      { id: companyId, ats: "greenhouse", slug: "acme", name: "Acme", website: "https://acme.io", homeCountry: "US", origin: "seed:yc", status: "active" },
    ]);
    expect(candidates()[0]).toMatchObject({ status: "confirmed", companyId, attempts: 1, lastCheckedAt: T0, nextCheckAt: null, ambiguousMatches: [] });
  });

  it("confirmed resolution reuses an existing company", () => {
    const existing = insertOrGetCompany(db, { ats: "greenhouse", slug: "acme", name: "Acme", website: null, homeCountry: null, origin: "manual" }, T0);
    const { companyId } = recordResolution(db, seed(), { status: "confirmed", ats: "greenhouse", slug: "acme", companyName: null }, T0);
    expect(companyId).toBe(existing);
    expect(allCompanies()).toHaveLength(1);
  });

  it("ambiguous keeps the matches and is not retried on a timer", () => {
    const id = seed();
    recordResolution(db, id, { status: "ambiguous", matches: [{ ats: "lever", slug: "acme" }] }, T0);
    expect(candidates()[0]).toMatchObject({ status: "ambiguous", ambiguousMatches: [{ ats: "lever", slug: "acme" }], nextCheckAt: null });
    expect(listAmbiguousCandidates(db).map((c) => c.id)).toEqual([id]);
  });

  it("not_found sets next check +30 days and clears matches", () => {
    const id = seed();
    recordResolution(db, id, { status: "ambiguous", matches: [{ ats: "lever", slug: "acme" }] }, T0);
    recordResolution(db, id, { status: "not_found" }, T0);
    expect(candidates()[0]).toMatchObject({ status: "not_found", nextCheckAt: plusDays(T0, 30), ambiguousMatches: [], attempts: 2 });
  });

  it("error sets next check +1 day", () => {
    const id = seed();
    recordResolution(db, id, { status: "error", error: "HTTP 500" }, T0);
    expect(candidates()[0]).toMatchObject({ status: "error", nextCheckAt: plusDays(T0, 1) });
  });

  const fail = (id: number, day: number) => recordResolution(db, id, { status: "error", error: "x" }, plusDays(T0, day));

  it("the first four errors in a row retry the next day", () => {
    const id = seed();
    for (const day of [0, 1, 2, 3]) fail(id, day);
    expect(candidates()[0]).toMatchObject({ status: "error", consecutiveErrors: 4, nextCheckAt: plusDays(T0, 4), attempts: 4 });
  });

  it("the fifth error in a row waits 30 days", () => {
    const id = seed();
    for (const day of [0, 1, 2, 3, 4]) fail(id, day);
    expect(candidates()[0]).toMatchObject({ consecutiveErrors: 5, nextCheckAt: plusDays(T0, 34) });
    expect(listDueCandidates(db, plusDays(T0, 10))).toEqual([]);
    expect(listDueCandidates(db, plusDays(T0, 34)).map((c) => c.id)).toEqual([id]);
  });

  it("any other result resets the error count", () => {
    const id = seed();
    fail(id, 0);
    fail(id, 1);
    recordResolution(db, id, { status: "not_found" }, plusDays(T0, 2));
    expect(candidates()[0]).toMatchObject({ consecutiveErrors: 0 });
    fail(id, 40);
    expect(candidates()[0]).toMatchObject({ consecutiveErrors: 1, nextCheckAt: plusDays(T0, 41) });
  });

  it("throws for an unknown candidate", () => {
    expect(() => recordResolution(db, 999, { status: "not_found" }, T0)).toThrow();
  });
});

describe("companies", () => {
  const add = (slug: string, ats: "greenhouse" | "lever" = "greenhouse") =>
    insertOrGetCompany(db, { ats, slug, name: slug, website: null, homeCountry: null, origin: "manual" }, T0);

  it("insertOrGetCompany is idempotent per ats+slug", () => {
    expect(add("acme")).toBe(add("acme"));
    expect(add("acme", "lever")).not.toBe(add("acme"));
  });

  it("due companies respect minHours and force", () => {
    const a = add("never-fetched");
    const b = add("fetched-recently");
    const c = add("fetched-long-ago");
    add("other-ats", "lever");
    recordCompanyFetch(db, b, { kind: "success" }, plusHours(T0, -5));
    recordCompanyFetch(db, c, { kind: "success" }, plusHours(T0, -30));
    expect(listDueCompanies(db, "greenhouse", T0).map((x) => x.id)).toEqual([a, c]);
    expect(listDueCompanies(db, "greenhouse", T0, { force: true }).map((x) => x.id)).toEqual([a, b, c]);
    expect(listDueCompanies(db, "greenhouse", T0, { minHours: 1 }).map((x) => x.id)).toEqual([a, b, c]);
  });

  it("inactive companies are never due", () => {
    const id = add("dead");
    for (let i = 0; i < 3; i++) recordCompanyFetch(db, id, { kind: "not_found", error: "404" }, T0);
    expect(listDueCompanies(db, "greenhouse", T0, { force: true })).toEqual([]);
  });

  it("three consecutive 404s deactivate and reopen the candidate", () => {
    upsertCandidate(db, { name: "Acme", origin: "seed:yc" }, T0);
    const cid = candidates()[0]!.id;
    const { companyId } = recordResolution(db, cid, { status: "confirmed", ats: "greenhouse", slug: "acme", companyName: null }, T0);
    recordCompanyFetch(db, companyId!, { kind: "not_found", error: "HTTP 404" }, T0);
    recordCompanyFetch(db, companyId!, { kind: "not_found", error: "HTTP 404" }, T0);
    expect(allCompanies()[0]).toMatchObject({ status: "active", consecutiveFailures: 2 });
    recordCompanyFetch(db, companyId!, { kind: "not_found", error: "HTTP 404" }, T0);
    expect(allCompanies()[0]).toMatchObject({ status: "inactive", consecutiveFailures: 3, lastError: "HTTP 404" });
    expect(candidates()[0]).toMatchObject({ status: "pending", nextCheckAt: null, companyId: null });
  });

  describe("jobs of a deactivated company", () => {
    const job = (externalId: string): Job => ({
      source: "greenhouse",
      externalId,
      url: `https://example.com/${externalId}`,
      applyUrl: null,
      title: "Developer",
      company: "Acme",
      location: null,
      workplaceType: "remote",
      departments: [],
      regions: [],
      employmentType: null,
      tags: [],
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      descriptionHtml: "",
      descriptionText: "",
      postedAt: null,
    });
    const closedAt = () => db.select().from(jobs).all().map((j) => [j.externalId, j.closedAt]);

    function setup() {
      const dead = add("dead");
      const alive = add("alive");
      upsertJobs(db, [job("dead:1"), job("dead:2")], T0, { companyId: dead });
      upsertJobs(db, [job("alive:1")], T0, { companyId: alive });
      return dead;
    }

    it("three consecutive 404s close the company's open jobs", () => {
      const dead = setup();
      recordCompanyFetch(db, dead, { kind: "not_found", error: "HTTP 404" }, plusDays(T0, 1));
      recordCompanyFetch(db, dead, { kind: "not_found", error: "HTTP 404" }, plusDays(T0, 2));
      recordCompanyFetch(db, dead, { kind: "not_found", error: "HTTP 404" }, plusDays(T0, 3));
      expect(closedAt()).toEqual([
        ["dead:1", plusDays(T0, 3)],
        ["dead:2", plusDays(T0, 3)],
        ["alive:1", null],
      ]);
    });

    it("fewer than three 404s close nothing", () => {
      const dead = setup();
      recordCompanyFetch(db, dead, { kind: "not_found", error: "HTTP 404" }, plusDays(T0, 1));
      recordCompanyFetch(db, dead, { kind: "not_found", error: "HTTP 404" }, plusDays(T0, 2));
      expect(closedAt()).toEqual([
        ["dead:1", null],
        ["dead:2", null],
        ["alive:1", null],
      ]);
    });
  });

  it("insertOrGetCompany reactivates an inactive company", () => {
    const id = add("acme");
    for (let i = 0; i < 3; i++) recordCompanyFetch(db, id, { kind: "not_found", error: "HTTP 404" }, T0);
    expect(allCompanies()[0]).toMatchObject({ status: "inactive", consecutiveFailures: 3 });
    expect(add("acme")).toBe(id);
    expect(allCompanies()[0]).toMatchObject({ status: "active", consecutiveFailures: 0, lastError: null });
  });

  it("a candidate re-confirmed to a deactivated company makes it due again", () => {
    upsertCandidate(db, { name: "Acme", origin: "seed:yc" }, T0);
    const candidateId = candidates()[0]!.id;
    const confirmed = { status: "confirmed", ats: "greenhouse", slug: "acme", companyName: null } as const;
    const { companyId } = recordResolution(db, candidateId, confirmed, T0);
    for (let i = 0; i < 3; i++) recordCompanyFetch(db, companyId!, { kind: "not_found", error: "HTTP 404" }, T0);
    expect(listDueCompanies(db, "greenhouse", plusDays(T0, 1))).toEqual([]);
    recordResolution(db, candidateId, confirmed, plusDays(T0, 1));
    expect(listDueCompanies(db, "greenhouse", plusDays(T0, 1)).map((c) => c.slug)).toEqual(["acme"]);
    expect(candidates()[0]).toMatchObject({ status: "confirmed", companyId });
  });

  it("insertOrGetCompany leaves an active company unchanged", () => {
    const id = add("acme");
    recordCompanyFetch(db, id, { kind: "not_found", error: "HTTP 404" }, T0);
    expect(add("acme")).toBe(id);
    expect(allCompanies()[0]).toMatchObject({ status: "active", consecutiveFailures: 1, lastError: "HTTP 404" });
  });

  it("a success resets failures", () => {
    const id = add("acme");
    recordCompanyFetch(db, id, { kind: "not_found", error: "404" }, T0);
    recordCompanyFetch(db, id, { kind: "success" }, plusHours(T0, 1));
    expect(allCompanies()[0]).toMatchObject({ consecutiveFailures: 0, lastError: null, lastFetchedAt: plusHours(T0, 1) });
  });

  it("a non-404 error records the attempt and keeps the failure count", () => {
    const id = add("acme");
    recordCompanyFetch(db, id, { kind: "success" }, T0);
    recordCompanyFetch(db, id, { kind: "not_found", error: "404" }, plusHours(T0, 25));
    recordCompanyFetch(db, id, { kind: "error", error: "HTTP 500" }, plusHours(T0, 26));
    expect(allCompanies()[0]).toMatchObject({ lastFetchedAt: plusHours(T0, 26), consecutiveFailures: 1, lastError: "HTTP 500", status: "active" });
  });

  it("a 404 is not retried within the day", () => {
    const id = add("acme");
    recordCompanyFetch(db, id, { kind: "not_found", error: "HTTP 404" }, T0);
    expect(listDueCompanies(db, "greenhouse", plusHours(T0, 5))).toEqual([]);
    expect(listDueCompanies(db, "greenhouse", plusHours(T0, 21)).map((c) => c.slug)).toEqual(["acme"]);
  });

  it("companyCounts reports active, inactive and active by ats", () => {
    add("a");
    add("b");
    const dead = add("c", "lever");
    for (let i = 0; i < 3; i++) recordCompanyFetch(db, dead, { kind: "not_found", error: "404" }, T0);
    add("d", "lever");
    expect(companyCounts(db)).toEqual({ active: 3, inactive: 1, byAts: { greenhouse: 2, lever: 1 } });
  });
});

describe("manual companies and lookups", () => {
  it("addManualCompany creates an active manual company", () => {
    const r = addManualCompany(db, { ats: "greenhouse", slug: "acme", name: "Acme", homeCountry: "US" }, T0);
    expect(r.created).toBe(true);
    expect(allCompanies()).toMatchObject([{ id: r.companyId, ats: "greenhouse", slug: "acme", name: "Acme", homeCountry: "US", origin: "manual", status: "active" }]);
  });

  it("addManualCompany reactivates an existing company and updates only what is given", () => {
    const id = insertOrGetCompany(db, { ats: "greenhouse", slug: "acme", name: "Old Name", website: "https://acme.io", homeCountry: "CA", origin: "seed:yc" }, T0);
    for (let i = 0; i < 3; i++) recordCompanyFetch(db, id, { kind: "not_found", error: "404" }, T0);
    expect(allCompanies()[0]).toMatchObject({ status: "inactive" });
    const r = addManualCompany(db, { ats: "greenhouse", slug: "acme", name: "New Name", homeCountry: null }, T0);
    expect(r).toEqual({ companyId: id, created: false, name: "New Name" });
    expect(allCompanies()[0]).toMatchObject({ name: "New Name", homeCountry: "CA", origin: "seed:yc", status: "active", consecutiveFailures: 0 });
  });

  it("getCandidate and findCandidateByName", () => {
    upsertCandidate(db, { name: "Acme Inc", origin: "seed:yc" }, T0);
    const id = candidates()[0]!.id;
    expect(getCandidate(db, id)?.name).toBe("Acme Inc");
    expect(getCandidate(db, 999)).toBeUndefined();
    expect(findCandidateByName(db, "ACME, Inc.")?.id).toBe(id);
    expect(findCandidateByName(db, "Other")).toBeUndefined();
  });

  it("listActiveCompanies excludes inactive companies", () => {
    const a = insertOrGetCompany(db, { ats: "lever", slug: "a", name: "A", website: null, homeCountry: null, origin: "manual" }, T0);
    const b = insertOrGetCompany(db, { ats: "lever", slug: "b", name: "B", website: null, homeCountry: null, origin: "manual" }, T0);
    for (let i = 0; i < 3; i++) recordCompanyFetch(db, b, { kind: "not_found", error: "404" }, T0);
    expect(listActiveCompanies(db).map((c) => c.id)).toEqual([a]);
  });
});
