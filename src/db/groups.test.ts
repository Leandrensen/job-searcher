import { asc } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Job } from "@/core/job";
import { openDb, type Db } from "./client";
import { insertOrGetCompany } from "./companies";
import { ensureJobGroups } from "./groups";
import { upsertJobs } from "./queries";
import { jobs } from "./schema";

const NOW = "2026-11-19T12:00:00.000Z";

function makeJob(externalId: string, over: Partial<Job> = {}): Job {
  return {
    source: "greenhouse",
    externalId,
    url: `https://example.com/${externalId}`,
    applyUrl: null,
    title: `Engineer ${externalId}`,
    company: "Acme",
    location: "Remote",
    workplaceType: "remote",
    departments: ["Engineering"],
    regions: [],
    employmentType: null,
    tags: [],
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    descriptionHtml: `<p>${externalId}</p>`,
    descriptionText: `Description ${externalId}`,
    postedAt: null,
    ...over,
  };
}

let db: Db;
beforeEach(() => {
  db = openDb({ url: ":memory:", migrate: true });
});

/** Clears every group, groups all jobs again in id order and returns their group ids in id order. */
function groupsAfterBackfill(): (number | null)[] {
  db.update(jobs).set({ groupId: null }).run();
  ensureJobGroups(db);
  return db
    .select()
    .from(jobs)
    .orderBy(asc(jobs.id))
    .all()
    .map((j) => j.groupId);
}

function insertCompany(): number {
  return insertOrGetCompany(db, { ats: "greenhouse", slug: "acme", name: "Acme", website: null, homeCountry: null, origin: "manual" }, NOW);
}

const BRAZIL = "Senior Engineer - Real Estate - Brazil/Remote";
const COLOMBIA = "Senior Engineer - Real Estate - Colombia/Remote";

describe("posting groups", () => {
  it("copies on one board with the same description share a group", () => {
    upsertJobs(
      db,
      ["1", "2", "3"].map((id) => makeJob(id, { title: "Same Title", descriptionText: "Same description" })),
      NOW,
    );
    expect(groupsAfterBackfill()).toEqual([1, 1, 1]);
  });

  it("the same title on one board with different descriptions is two postings", () => {
    upsertJobs(
      db,
      [makeJob("1", { title: "Same Title", descriptionText: "Payments team" }), makeJob("2", { title: "Same Title", descriptionText: "Infra team" })],
      NOW,
    );
    expect(groupsAfterBackfill()).toEqual([1, 2]);
  });

  it("the same title from another job site joins the group", () => {
    upsertJobs(db, [makeJob("1", { title: "Same Title" })], NOW);
    upsertJobs(db, [makeJob("9", { source: "lever", title: "Same Title" })], NOW);
    expect(groupsAfterBackfill()).toEqual([1, 1]);
  });

  it("a shared apply URL joins the group", () => {
    upsertJobs(
      db,
      [makeJob("1", { applyUrl: "https://apply.example.com/x" }), makeJob("2", { applyUrl: "https://apply.example.com/x" })],
      NOW,
    );
    expect(groupsAfterBackfill()).toEqual([1, 1]);
  });

  it("a copy from another site doesn't hide a different opening", () => {
    upsertJobs(db, [makeJob("1", { title: "Software Engineer in Test", descriptionText: "Payments team" })], NOW);
    upsertJobs(db, [makeJob("2", { source: "lever", title: "Software Engineer in Test" })], NOW);
    upsertJobs(db, [makeJob("3", { title: "Software Engineer in Test", descriptionText: "Infra team" })], NOW);
    expect(groupsAfterBackfill()).toEqual([1, 1, 3]);
  });

  it("an ambiguous copy joins the oldest group without merging", () => {
    upsertJobs(db, [makeJob("1", { title: "Software Engineer in Test", descriptionText: "Payments team" })], NOW);
    upsertJobs(db, [makeJob("2", { title: "Software Engineer in Test", descriptionText: "Infra team" })], NOW);
    upsertJobs(db, [makeJob("3", { source: "lever", title: "Software Engineer in Test" })], NOW);
    expect(groupsAfterBackfill()).toEqual([1, 2, 1]);
  });

  it("a job linking two groups merges them", () => {
    upsertJobs(db, [makeJob("1", { source: "lever", title: "Senior Engineer", applyUrl: "https://apply.example.com/u1" })], NOW);
    upsertJobs(
      db,
      [makeJob("2", { source: "ashby", title: "Senior Engineer (Remote)", applyUrl: "https://apply.example.com/u2", descriptionText: "Same description" })],
      NOW,
    );
    upsertJobs(
      db,
      [makeJob("3", { source: "ashby", title: "Senior Engineer (Remote)", applyUrl: "https://apply.example.com/u1", descriptionText: "Same description" })],
      NOW,
    );
    expect(groupsAfterBackfill()).toEqual([1, 1, 1]);
  });

  it("a job first seen more than 30 days after the other was last seen is another posting", () => {
    upsertJobs(db, [makeJob("1", { title: "Same Title" })], NOW);
    upsertJobs(db, [makeJob("2", { source: "lever", title: "Same Title" })], "2026-12-20T12:00:00.000Z");
    expect(groupsAfterBackfill()).toEqual([1, 2]);
  });

  it("empty descriptions never match", () => {
    upsertJobs(db, [makeJob("1", { title: "Same Title", descriptionText: "" }), makeJob("2", { title: "Same Title", descriptionText: "" })], NOW);
    expect(groupsAfterBackfill()).toEqual([1, 2]);
  });

  it("location variants on one company board share a group", () => {
    const companyId = insertCompany();
    upsertJobs(
      db,
      [makeJob("1", { title: BRAZIL, descriptionText: "Same description" }), makeJob("2", { title: COLOMBIA, descriptionText: "Same description" })],
      NOW,
      { companyId },
    );
    expect(groupsAfterBackfill()).toEqual([1, 1]);
  });

  it("different titles with the same description stay apart without a company", () => {
    upsertJobs(
      db,
      [makeJob("1", { title: BRAZIL, descriptionText: "Same description" }), makeJob("2", { title: COLOMBIA, descriptionText: "Same description" })],
      NOW,
    );
    expect(groupsAfterBackfill()).toEqual([1, 2]);
  });

  it("different descriptions on one company board stay apart", () => {
    const companyId = insertCompany();
    upsertJobs(
      db,
      [makeJob("1", { title: BRAZIL, descriptionText: "Payments team" }), makeJob("2", { title: COLOMBIA, descriptionText: "Infra team" })],
      NOW,
      { companyId },
    );
    expect(groupsAfterBackfill()).toEqual([1, 2]);
  });

  it("ensureJobGroups counts the jobs it grouped and is idempotent", () => {
    upsertJobs(db, [makeJob("1"), makeJob("2")], NOW);
    db.update(jobs).set({ groupId: null }).run();
    expect(ensureJobGroups(db)).toBe(2);
    expect(ensureJobGroups(db)).toBe(0);
  });

  it("ensureJobGroups returns 0 with no jobs", () => {
    expect(ensureJobGroups(db)).toBe(0);
  });
});
