import { beforeEach, describe, expect, it } from "vitest";
import type { Job } from "@/core/job";
import { openDb, type Db } from "./client";
import { insertOrGetCompany } from "./companies";
import { markClosedJobs, upsertJobs } from "./queries";
import { getEmbeddings, listOpenJobsForRanking, saveEmbeddings } from "./ranking";

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
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        salaryPeriod: null,
        descriptionText: "Description a:2",
      },
    ]);
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
