import { beforeEach, describe, expect, it } from "vitest";
import type { Job } from "@/core/job";
import { openDb, type Db } from "./client";
import { insertOrGetCompany } from "./companies";
import { countJobs, lastSuccessfulRunAt, latestPostedAt, markClosedJobs, purgeClosedJobs, recordRun, upsertJobs } from "./queries";
import { jobs } from "./schema";

function makeJob(over: Partial<Job> = {}): Job {
  return {
    source: "remoteok",
    externalId: "1",
    url: "https://example.com/1",
    applyUrl: null,
    title: "Developer",
    company: "Acme",
    location: null,
    workplaceType: "remote",
    departments: [],
    regions: [],
    employmentType: null,
    tags: ["react"],
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    descriptionHtml: "<p>x</p>",
    descriptionText: "x",
    postedAt: "2026-11-08T00:00:00.000Z",
    ...over,
  };
}

let db: Db;
beforeEach(() => {
  db = openDb({ url: ":memory:", migrate: true });
});

describe("upsertJobs", () => {
  it("inserts new jobs and counts them", () => {
    const r = upsertJobs(db, [makeJob(), makeJob({ externalId: "2" })], "2026-11-09T00:00:00.000Z");
    expect(r).toEqual({ inserted: 2, updated: 0 });
    expect(countJobs(db)).toBe(2);
    expect(countJobs(db, "remoteok")).toBe(2);
    expect(countJobs(db, "jobicy")).toBe(0);
  });

  it("second upsert of same jobs counts as updated and keeps firstSeenAt", () => {
    upsertJobs(db, [makeJob()], "2026-11-09T00:00:00.000Z");
    const r = upsertJobs(db, [makeJob()], "2026-11-10T00:00:00.000Z");
    expect(r).toEqual({ inserted: 0, updated: 1 });
    const row = db.select().from(jobs).get();
    expect(row?.firstSeenAt).toBe("2026-11-09T00:00:00.000Z");
    expect(row?.lastSeenAt).toBe("2026-11-10T00:00:00.000Z");
  });

  it("updates changed title and dedupe key", () => {
    upsertJobs(db, [makeJob()], "2026-11-09T00:00:00.000Z");
    upsertJobs(db, [makeJob({ title: "Senior Developer" })], "2026-11-10T00:00:00.000Z");
    const row = db.select().from(jobs).get();
    expect(row?.title).toBe("Senior Developer");
    expect(row?.dedupeKey).toBe("acme|senior developer");
  });

  it("treats the same externalId on different sources as different jobs", () => {
    const r = upsertJobs(db, [makeJob(), makeJob({ source: "jobicy" })], "2026-11-09T00:00:00.000Z");
    expect(r.inserted).toBe(2);
  });
});

describe("latestPostedAt", () => {
  it("returns max postedAt per source and null when empty", () => {
    expect(latestPostedAt(db, "remoteok")).toBeNull();
    upsertJobs(
      db,
      [
        makeJob({ postedAt: "2026-11-01T00:00:00.000Z" }),
        makeJob({ externalId: "2", postedAt: "2026-11-05T00:00:00.000Z" }),
        makeJob({ source: "jobicy", postedAt: "2026-11-09T00:00:00.000Z" }),
      ],
      "2026-11-09T00:00:00.000Z",
    );
    expect(latestPostedAt(db, "remoteok")).toBe("2026-11-05T00:00:00.000Z");
  });
});

describe("lastSuccessfulRunAt", () => {
  it("ignores error and skipped runs", () => {
    expect(lastSuccessfulRunAt(db, "remoteok")).toBeNull();
    recordRun(db, { source: "remoteok", startedAt: "a", finishedAt: "2026-11-08T00:00:00.000Z", status: "success" });
    recordRun(db, { source: "remoteok", startedAt: "b", finishedAt: "2026-11-09T00:00:00.000Z", status: "error", error: "x" });
    recordRun(db, { source: "remoteok", startedAt: "c", finishedAt: "2026-11-10T00:00:00.000Z", status: "skipped" });
    expect(lastSuccessfulRunAt(db, "remoteok")).toBe("2026-11-08T00:00:00.000Z");
  });
});

describe("duplicate marking", () => {
  const NOW = "2026-11-09T00:00:00.000Z";

  it("marks same company+title from another source as duplicate", () => {
    upsertJobs(db, [makeJob({ source: "remoteok", externalId: "a", company: "Acme Inc", title: "Senior Dev!" })], NOW);
    upsertJobs(db, [makeJob({ source: "jobicy", externalId: "b", company: "ACME", title: "senior dev" })], NOW);
    const rows = db.select().from(jobs).all();
    const original = rows.find((r) => r.source === "remoteok");
    const copy = rows.find((r) => r.source === "jobicy");
    expect(original?.duplicateOf).toBeNull();
    expect(copy?.duplicateOf).toBe(original?.id);
  });

  it("does not mark same-source jobs", () => {
    upsertJobs(db, [makeJob({ externalId: "a" }), makeJob({ externalId: "b" })], NOW);
    expect(db.select().from(jobs).all().every((r) => r.duplicateOf === null)).toBe(true);
  });

  it("does not mark when original is older than 30 days", () => {
    upsertJobs(db, [makeJob({ source: "remoteok", externalId: "a" })], "2026-10-09T00:00:00.000Z");
    upsertJobs(db, [makeJob({ source: "jobicy", externalId: "b" })], NOW);
    expect(db.select().from(jobs).all().every((r) => r.duplicateOf === null)).toBe(true);
  });

  it("matches on identical applyUrl", () => {
    const applyUrl = "https://boards.greenhouse.io/acme/jobs/1";
    upsertJobs(db, [makeJob({ source: "remoteok", externalId: "a", title: "Dev A", applyUrl })], NOW);
    upsertJobs(db, [makeJob({ source: "jobicy", externalId: "b", company: "Other", title: "Totally different", applyUrl })], NOW);
    const rows = db.select().from(jobs).all();
    expect(rows.find((r) => r.source === "jobicy")?.duplicateOf).toBe(rows.find((r) => r.source === "remoteok")?.id);
  });

  it("does not match null applyUrls to each other", () => {
    upsertJobs(db, [makeJob({ source: "remoteok", externalId: "a", title: "One" })], NOW);
    upsertJobs(db, [makeJob({ source: "jobicy", externalId: "b", company: "Other", title: "Two" })], NOW);
    expect(db.select().from(jobs).all().every((r) => r.duplicateOf === null)).toBe(true);
  });

  it("points at the oldest original and never chains duplicates", () => {
    upsertJobs(db, [makeJob({ source: "remoteok", externalId: "a" })], NOW);
    upsertJobs(db, [makeJob({ source: "jobicy", externalId: "b" })], NOW);
    upsertJobs(db, [makeJob({ source: "remotive", externalId: "c" })], NOW);
    const rows = db.select().from(jobs).all();
    const original = rows.find((r) => r.source === "remoteok");
    expect(rows.find((r) => r.source === "jobicy")?.duplicateOf).toBe(original?.id);
    expect(rows.find((r) => r.source === "remotive")?.duplicateOf).toBe(original?.id);
  });

  it("does not change duplicateOf when an existing job is updated", () => {
    upsertJobs(db, [makeJob({ source: "remoteok", externalId: "a" })], NOW);
    upsertJobs(db, [makeJob({ source: "jobicy", externalId: "b" })], NOW);
    upsertJobs(db, [makeJob({ source: "jobicy", externalId: "b", title: "Developer" })], "2026-11-10T00:00:00.000Z");
    const copy = db.select().from(jobs).all().find((r) => r.source === "jobicy");
    expect(copy?.duplicateOf).not.toBeNull();
  });
});

describe("ATS job storage", () => {
  const NOW = "2026-11-16T12:00:00.000Z";
  const daysAgo = (d: number) => new Date(Date.parse(NOW) - d * 86_400_000).toISOString();
  const company = (slug: string) =>
    insertOrGetCompany(db, { ats: "greenhouse", slug, name: slug, website: null, homeCountry: null, origin: "manual" }, NOW);
  const ats = (externalId: string, over: Partial<Job> = {}) =>
    makeJob({ source: "greenhouse", externalId: `acme:${externalId}`, title: `Engineer ${externalId}`, ...over });
  const rows = () => db.select().from(jobs).all();

  it("stores companyId", () => {
    const id = company("acme");
    upsertJobs(db, [ats("1")], NOW, { companyId: id });
    expect(rows()[0]?.companyId).toBe(id);
  });

  it("markClosedJobs closes only unseen open jobs of that company", () => {
    const acme = company("acme");
    const other = company("other");
    upsertJobs(db, [ats("1"), ats("2"), ats("3")], NOW, { companyId: acme });
    upsertJobs(db, [makeJob({ source: "greenhouse", externalId: "other:1", title: "Other job" })], NOW, { companyId: other });
    const closed = markClosedJobs(db, acme, ["acme:1", "acme:3"], "2026-11-17T00:00:00.000Z");
    expect(closed).toBe(1);
    const byId = Object.fromEntries(rows().map((r) => [r.externalId, r.closedAt]));
    expect(byId).toEqual({
      "acme:1": null,
      "acme:2": "2026-11-17T00:00:00.000Z",
      "acme:3": null,
      "other:1": null,
    });
    // Already-closed jobs are not closed again.
    expect(markClosedJobs(db, acme, ["acme:1", "acme:3"], "2026-11-18T00:00:00.000Z")).toBe(0);
    expect(rows().find((r) => r.externalId === "acme:2")?.closedAt).toBe("2026-11-17T00:00:00.000Z");
  });

  it("markClosedJobs with an empty list closes all of the company's open jobs", () => {
    const acme = company("acme");
    upsertJobs(db, [ats("1"), ats("2")], NOW, { companyId: acme });
    expect(markClosedJobs(db, acme, [], NOW)).toBe(2);
  });

  it("a reappearing job is reopened by upsert", () => {
    const acme = company("acme");
    upsertJobs(db, [ats("1")], NOW, { companyId: acme });
    markClosedJobs(db, acme, [], NOW);
    expect(rows()[0]?.closedAt).toBe(NOW);
    const r = upsertJobs(db, [ats("1")], "2026-11-17T00:00:00.000Z", { companyId: acme });
    expect(r).toEqual({ inserted: 0, updated: 1 });
    expect(rows()[0]?.closedAt).toBeNull();
  });

  it("purge deletes jobs closed more than 30 days ago only", () => {
    const acme = company("acme");
    upsertJobs(db, [ats("old"), ats("recent"), ats("open")], NOW, { companyId: acme });
    markClosedJobs(db, acme, ["acme:recent", "acme:open"], daysAgo(31)); // closes "old" 31 days ago
    markClosedJobs(db, acme, ["acme:open"], daysAgo(29)); // closes "recent" 29 days ago
    expect(purgeClosedJobs(db, NOW)).toBe(1);
    expect(rows().map((r) => r.externalId).sort()).toEqual(["acme:open", "acme:recent"]);
    expect(purgeClosedJobs(db, NOW, 10)).toBe(1);
    expect(rows().map((r) => r.externalId)).toEqual(["acme:open"]);
  });

  it("purge clears duplicate_of pointers first", () => {
    const acme = company("acme");
    upsertJobs(db, [ats("1", { title: "Same Title", company: "Acme" })], NOW, { companyId: acme });
    upsertJobs(db, [makeJob({ source: "lever", externalId: "acme:9", title: "Same Title", company: "Acme" })], NOW);
    expect(rows().find((r) => r.source === "lever")?.duplicateOf).not.toBeNull();
    markClosedJobs(db, acme, [], daysAgo(40));
    expect(purgeClosedJobs(db, NOW)).toBe(1);
    const remaining = rows();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ source: "lever", duplicateOf: null });
  });

  it("countJobs openOnly excludes closed jobs and still accepts a plain source", () => {
    const acme = company("acme");
    upsertJobs(db, [ats("1"), ats("2")], NOW, { companyId: acme });
    markClosedJobs(db, acme, ["acme:1"], NOW);
    expect(countJobs(db)).toBe(2);
    expect(countJobs(db, { openOnly: true })).toBe(1);
    expect(countJobs(db, { source: "greenhouse", openOnly: true })).toBe(1);
    expect(countJobs(db, { source: "lever" })).toBe(0);
    expect(countJobs(db, "greenhouse")).toBe(2);
  });
});
