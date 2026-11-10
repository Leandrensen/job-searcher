import { beforeEach, describe, expect, it } from "vitest";
import type { Job } from "@/core/job";
import { openDb, type Db } from "./client";
import { countJobs, lastSuccessfulRunAt, latestPostedAt, recordRun, upsertJobs } from "./queries";
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
    remote: true,
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
