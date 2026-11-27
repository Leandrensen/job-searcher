import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Job } from "@/core/job";
import { openDb, type Db } from "./client";
import { insertOrGetCompany } from "./companies";
import { markClosedJobs, upsertJobs } from "./queries";
import { countOpenPostings, getEmbeddings, listOpenJobsForRanking, saveEmbeddings } from "./ranking";
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

describe("listOpenJobsForRanking", () => {
  it("lists only open jobs, ordered by id, with the ranking fields", () => {
    const acme = insertOrGetCompany(db, { ats: "greenhouse", slug: "acme", name: "Acme", website: null, homeCountry: null, origin: "manual" }, NOW);
    upsertJobs(
      db,
      [makeJob("a:1", { salaryMin: 80000, salaryMax: 100000, salaryCurrency: "USD", salaryPeriod: "year" }), makeJob("a:2", { location: null }), makeJob("a:3")],
      NOW,
      { companyId: acme },
    );
    markClosedJobs(db, acme, ["a:1", "a:2"], NOW); // closes a:3
    expect(listOpenJobsForRanking(db)).toEqual([
      {
        id: 1,
        title: "Engineer a:1",
        company: "Acme",
        location: "Remote",
        url: "https://example.com/a:1",
        departments: ["Engineering"],
        tags: [],
        salaryMin: 80000,
        salaryMax: 100000,
        salaryCurrency: "USD",
        salaryPeriod: "year",
        descriptionText: "Description a:1",
      },
      {
        id: 2,
        title: "Engineer a:2",
        company: "Acme",
        location: null,
        url: "https://example.com/a:2",
        departments: ["Engineering"],
        tags: [],
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        salaryPeriod: null,
        descriptionText: "Description a:2",
      },
    ]);
  });
});

describe("tags", () => {
  it("includes the job's tags", () => {
    upsertJobs(db, [makeJob("1", { tags: ["react", "remote"] })], NOW);
    expect(listOpenJobsForRanking(db)[0]!.tags).toEqual(["react", "remote"]);
  });
});

describe("duplicates", () => {
  it("skips jobs marked as a duplicate of another", () => {
    upsertJobs(db, [makeJob("1", { title: "Same Title", company: "Acme" })], NOW);
    upsertJobs(db, [makeJob("9", { source: "lever", title: "Same Title", company: "Acme" })], NOW);
    expect(listOpenJobsForRanking(db).map((j) => j.id)).toEqual([1]);
  });

  function insertOriginalAndCopy(): void {
    upsertJobs(db, [makeJob("1", { title: "Same Title", company: "Acme" })], NOW);
    upsertJobs(db, [makeJob("9", { source: "lever", title: "Same Title", company: "Acme" })], NOW);
  }

  function setClosedAt(id: number, closedAt: string | null): void {
    db.update(jobs).set({ closedAt }).where(eq(jobs.id, id)).run();
  }

  it("ranks the duplicate once its original closes", () => {
    insertOriginalAndCopy();
    setClosedAt(1, NOW);
    expect(listOpenJobsForRanking(db).map((j) => j.id)).toEqual([2]);
  });

  it("skips the duplicate again if the original reopens", () => {
    insertOriginalAndCopy();
    expect(db.select().from(jobs).all().map((j) => [j.id, j.duplicateOf])).toEqual([
      [1, null],
      [2, 1],
    ]);
    setClosedAt(1, NOW);
    setClosedAt(1, null);
    expect(listOpenJobsForRanking(db).map((j) => j.id)).toEqual([1]);
  });

  it("ranks only the oldest open duplicate of a closed original", () => {
    upsertJobs(db, [makeJob("1", { title: "Same Title", company: "Acme" })], NOW);
    upsertJobs(db, [makeJob("9", { source: "lever", title: "Same Title", company: "Acme" })], NOW);
    upsertJobs(db, [makeJob("7", { source: "ashby", title: "Same Title", company: "Acme" })], NOW);
    expect(db.select().from(jobs).all().map((j) => [j.id, j.duplicateOf])).toEqual([
      [1, null],
      [2, 1],
      [3, 1],
    ]);
    setClosedAt(1, NOW);
    expect(listOpenJobsForRanking(db).map((j) => j.id)).toEqual([2]);
  });

  it("ranks a job whose duplicateOf points at a missing row", () => {
    upsertJobs(db, [makeJob("1")], NOW);
    // Foreign keys are on, so a dangling pointer can only be written with them off.
    db.run(sql`PRAGMA foreign_keys = OFF`);
    db.update(jobs).set({ duplicateOf: 999 }).where(eq(jobs.id, 1)).run();
    db.run(sql`PRAGMA foreign_keys = ON`);
    expect(listOpenJobsForRanking(db).map((j) => j.id)).toEqual([1]);
  });

  it("returns [] when there are no open jobs", () => {
    expect(listOpenJobsForRanking(db)).toEqual([]);
  });

  it("returns exactly the RankableJob fields", () => {
    insertOriginalAndCopy();
    setClosedAt(1, NOW);
    expect(Object.keys(listOpenJobsForRanking(db)[0]!).sort()).toEqual([
      "company",
      "departments",
      "descriptionText",
      "id",
      "location",
      "salaryCurrency",
      "salaryMax",
      "salaryMin",
      "salaryPeriod",
      "tags",
      "title",
      "url",
    ]);
  });

  const ids = () => listOpenJobsForRanking(db).map((j) => j.id);

  function insertThreeCities(): void {
    upsertJobs(
      db,
      [
        makeJob("1", { title: "Same Title", location: "Bogota", descriptionText: "Same description" }),
        makeJob("2", { title: "Same Title", location: "Lima", descriptionText: "Same description" }),
        makeJob("3", { title: "Same Title", location: "LatAm", descriptionText: "Same description" }),
      ],
      NOW,
    );
  }

  it("ranks one copy of a posting listed in several cities", () => {
    insertThreeCities();
    expect(db.select().from(jobs).all().map((j) => j.duplicateOf)).toEqual([null, null, null]);
    expect(ids()).toEqual([1]);
  });

  it("the next copy is ranked when the first closes", () => {
    insertThreeCities();
    setClosedAt(1, NOW);
    expect(ids()).toEqual([2]);
  });

  it("a title differing only in case and punctuation is the same posting", () => {
    upsertJobs(
      db,
      [
        makeJob("1", { title: "Senior Full-Stack Engineer", descriptionText: "Same description" }),
        makeJob("2", { title: "senior full stack engineer", descriptionText: "Same description" }),
      ],
      NOW,
    );
    expect(ids()).toEqual([1]);
  });

  it("the same title on one board with different descriptions is two jobs", () => {
    upsertJobs(
      db,
      [
        makeJob("1", { title: "Software Engineer in Test", descriptionText: "Payments team" }),
        makeJob("2", { title: "Software Engineer in Test", descriptionText: "Infra team" }),
      ],
      NOW,
    );
    expect(ids()).toEqual([1, 2]);
  });

  it("the same title from another source is one job even when the text differs", () => {
    upsertJobs(db, [makeJob("1", { title: "Same Title", descriptionText: "Greenhouse text" })], NOW);
    upsertJobs(db, [makeJob("9", { source: "lever", title: "Same Title", descriptionText: "Lever text" })], NOW);
    expect(ids()).toEqual([1]);
  });

  it("the same title on another site long after is another job", () => {
    upsertJobs(db, [makeJob("1", { title: "Same Title" })], NOW);
    upsertJobs(db, [makeJob("9", { source: "lever", title: "Same Title" })], "2026-12-21T12:00:00.000Z");
    expect(ids()).toEqual([1, 2]);
  });

  it("a copy from another site doesn't hide a different opening", () => {
    upsertJobs(db, [makeJob("1", { title: "Software Engineer in Test", descriptionText: "Payments team" })], NOW);
    upsertJobs(db, [makeJob("2", { source: "lever", title: "Software Engineer in Test" })], NOW);
    upsertJobs(db, [makeJob("3", { title: "Software Engineer in Test", descriptionText: "Infra team" })], NOW);
    expect(ids()).toEqual([1, 3]);
  });

  it("countOpenPostings counts groups with an open job", () => {
    insertThreeCities();
    upsertJobs(db, [makeJob("4")], NOW);
    expect(countOpenPostings(db)).toBe(2);
    setClosedAt(4, NOW);
    expect(countOpenPostings(db)).toBe(1);
  });

  it("countOpenPostings is 0 with no open jobs", () => {
    expect(countOpenPostings(db)).toBe(0);
  });

  it("a copy linked only through a skipped copy is ranked once", () => {
    upsertJobs(db, [makeJob("1", { source: "lever", title: "Senior Engineer", applyUrl: "https://apply.example.com/u" })], NOW);
    upsertJobs(
      db,
      [makeJob("2", { source: "ashby", title: "Senior Engineer (Remote)", applyUrl: "https://apply.example.com/u", descriptionText: "Same description" })],
      NOW,
    );
    upsertJobs(
      db,
      [makeJob("3", { source: "ashby", title: "Senior Engineer (Remote)", applyUrl: "https://apply.example.com/u2", descriptionText: "Same description" })],
      NOW,
    );
    expect(db.select().from(jobs).all().map((j) => [j.id, j.duplicateOf])).toEqual([
      [1, null],
      [2, 1],
      [3, null],
    ]);
    expect(ids()).toEqual([1]);
  });

  it("the same title at another company is another job", () => {
    upsertJobs(db, [makeJob("1", { title: "Same Title" }), makeJob("2", { title: "Same Title", company: "Globex" })], NOW);
    expect(ids()).toEqual([1, 2]);
  });

  it("jobs sharing an apply URL are ranked once", () => {
    upsertJobs(
      db,
      [makeJob("1", { applyUrl: "https://apply.example.com/x" }), makeJob("2", { applyUrl: "https://apply.example.com/x" })],
      NOW,
    );
    expect(ids()).toEqual([1]);
  });

  it("a copy from a third site after the original closes is ranked once", () => {
    upsertJobs(db, [makeJob("1", { title: "Same Title" })], NOW);
    upsertJobs(db, [makeJob("9", { source: "lever", title: "Same Title" })], NOW);
    setClosedAt(1, NOW);
    upsertJobs(db, [makeJob("7", { source: "ashby", title: "Same Title" })], NOW);
    expect(db.select().from(jobs).all().map((j) => [j.id, j.duplicateOf])).toEqual([
      [1, null],
      [2, 1],
      [3, null],
    ]);
    expect(ids()).toEqual([2]);
  });
});

describe("filter", () => {
  it("a passing copy is ranked when the lowest-id copy fails the filter", () => {
    upsertJobs(db, [makeJob("1", { title: "Same Title", departments: ["Sales"] })], NOW);
    upsertJobs(db, [makeJob("9", { source: "lever", title: "Same Title" })], NOW);
    expect(listOpenJobsForRanking(db, (j) => !j.departments.includes("Sales")).map((j) => j.id)).toEqual([2]);
    expect(listOpenJobsForRanking(db).map((j) => j.id)).toEqual([1]);
  });

  it("a filter rejecting every job gives []", () => {
    upsertJobs(db, [makeJob("1")], NOW);
    expect(listOpenJobsForRanking(db, () => false)).toEqual([]);
  });
});

describe("embeddings", () => {
  beforeEach(() => {
    upsertJobs(db, [makeJob("1"), makeJob("2")], NOW);
  });

  it("saves and reads back embeddings", () => {
    saveEmbeddings(db, [{ jobId: 1, model: "m", textHash: "h", vector: new Float32Array([0.25, 0.5, -0.75]) }], NOW);
    const found = getEmbeddings(db, [1, 2]);
    expect(found.size).toBe(1);
    expect(found.get(1)?.model).toBe("m");
    expect(found.get(1)?.textHash).toBe("h");
    expect(Array.from(found.get(1)!.vector)).toEqual([0.25, 0.5, -0.75]);
  });

  it("saving again replaces the row", () => {
    saveEmbeddings(db, [{ jobId: 1, model: "m", textHash: "h", vector: new Float32Array([0.25, 0.5]) }], NOW);
    saveEmbeddings(db, [{ jobId: 1, model: "m", textHash: "h2", vector: new Float32Array([1]) }], NOW);
    const row = getEmbeddings(db, [1]).get(1)!;
    expect(row.textHash).toBe("h2");
    expect(Array.from(row.vector)).toEqual([1]);
  });

  it("getEmbeddings with no ids returns an empty map", () => {
    expect(getEmbeddings(db, []).size).toBe(0);
  });
});
