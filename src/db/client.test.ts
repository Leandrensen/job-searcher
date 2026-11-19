import { describe, expect, it } from "vitest";
import { companies, companyCandidates, fetchRuns, jobs } from "./schema";
import { openDb } from "./client";

const baseJob = {
  source: "remoteok",
  externalId: "1",
  url: "https://example.com/1",
  title: "Dev",
  company: "Acme",
  descriptionHtml: "<p>x</p>",
  descriptionText: "x",
  firstSeenAt: "2026-11-09T00:00:00.000Z",
  lastSeenAt: "2026-11-09T00:00:00.000Z",
  dedupeKey: "acme|dev",
};

describe("openDb", () => {
  it("creates both tables when migrate is true", () => {
    const db = openDb({ url: ":memory:", migrate: true });
    db.insert(jobs).values({ ...baseJob, tags: ["a"], workplaceType: "remote", departments: ["Eng"], regions: ["latam"], employmentType: "full-time" }).run();
    db.insert(fetchRuns)
      .values({ source: "remoteok", startedAt: "s", finishedAt: "f", status: "success" })
      .run();
    const job = db.select().from(jobs).get();
    expect(job?.title).toBe("Dev");
    expect(job?.tags).toEqual(["a"]);
    expect(job?.workplaceType).toBe("remote");
    expect(job?.departments).toEqual(["Eng"]);
    expect(job?.regions).toEqual(["latam"]);
    expect(job?.employmentType).toBe("full-time");
    expect(db.select().from(fetchRuns).get()?.fetched).toBe(0);
  });

  it("enforces unique source + external_id", () => {
    const db = openDb({ url: ":memory:", migrate: true });
    db.insert(jobs).values(baseJob).run();
    expect(() => db.insert(jobs).values(baseJob).run()).toThrow();
  });
  const company = {
    ats: "greenhouse" as const,
    slug: "acme",
    name: "Acme",
    origin: "manual",
    createdAt: "2026-11-16T00:00:00.000Z",
  };

  it("creates companies and company_candidates", () => {
    const db = openDb({ url: ":memory:", migrate: true });
    const c = db.insert(companies).values(company).returning().get();
    expect(c).toMatchObject({ status: "active", consecutiveFailures: 0, homeCountry: null, lastFetchedAt: null });
    const cand = db
      .insert(companyCandidates)
      .values({
        normalizedName: "acme",
        name: "Acme",
        origin: "seed:yc",
        createdAt: "2026-11-16T00:00:00.000Z",
        companyId: c.id,
        ambiguousMatches: [{ ats: "lever", slug: "acme" }],
      })
      .returning()
      .get();
    expect(cand).toMatchObject({ status: "pending", attempts: 0, atsHints: [], nextCheckAt: null, companyId: c.id });
    expect(cand.ambiguousMatches).toEqual([{ ats: "lever", slug: "acme" }]);
  });

  it("enforces unique ats+slug on companies", () => {
    const db = openDb({ url: ":memory:", migrate: true });
    db.insert(companies).values(company).run();
    expect(() => db.insert(companies).values({ ...company, name: "Other" }).run()).toThrow();
    db.insert(companies).values({ ...company, ats: "lever" }).run();
  });

  it("enforces unique normalized_name on company_candidates", () => {
    const db = openDb({ url: ":memory:", migrate: true });
    const cand = { normalizedName: "acme", name: "Acme", origin: "seed:yc", createdAt: "2026-11-16T00:00:00.000Z" };
    db.insert(companyCandidates).values(cand).run();
    expect(() => db.insert(companyCandidates).values({ ...cand, name: "ACME Inc" }).run()).toThrow();
  });

  it("jobs accept company_id and closed_at", () => {
    const db = openDb({ url: ":memory:", migrate: true });
    const c = db.insert(companies).values(company).returning().get();
    db.insert(jobs).values({ ...baseJob, companyId: c.id, closedAt: "2026-11-20T00:00:00.000Z" }).run();
    const job = db.select().from(jobs).get();
    expect(job?.companyId).toBe(c.id);
    expect(job?.closedAt).toBe("2026-11-20T00:00:00.000Z");
  });
});
