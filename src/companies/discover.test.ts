import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "@/core/job";
import { openDb, type Db } from "@/db/client";
import { companyCandidates, fetchRuns } from "@/db/schema";
import { createHimalayas } from "@/sources/boards/himalayas";
import { runBoardSources } from "@/sources/board-runner";
import type { HttpClient } from "@/core/http";
import { loadFixture } from "@/test-utils/fixtures";
import { recordCandidatesFromBoardJobs } from "./discover";

const NOW = "2026-11-16T12:00:00.000Z";

const job = (over: Partial<Job> = {}): Job => ({
  source: "remoteok",
  externalId: "1",
  url: "https://remoteok.com/remote-jobs/1",
  applyUrl: null,
  title: "Backend Developer",
  company: "Acme Inc",
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
  ...over,
});

let db: Db;
beforeEach(() => {
  db = openDb({ url: ":memory:", migrate: true });
});
const candidates = () => db.select().from(companyCandidates).all();

describe("recordCandidatesFromBoardJobs", () => {
  it("creates a pending candidate per company with the board as origin", () => {
    const r = recordCandidatesFromBoardJobs(db, "remoteok", [job(), job({ externalId: "2", company: "Globex" })], NOW);
    expect(r).toEqual({ inserted: 2, updated: 0 });
    expect(candidates()).toMatchObject([
      { name: "Acme Inc", origin: "board:remoteok", status: "pending", atsHints: [], website: null },
      { name: "Globex", origin: "board:remoteok", status: "pending" },
    ]);
  });

  it("adds ats hints found in the url, apply url and description, in order", () => {
    recordCandidatesFromBoardJobs(
      db,
      "weworkremotely",
      [
        job({
          applyUrl: "https://boards.greenhouse.io/acme/jobs/5",
          descriptionHtml: '<a href="https:&#x2F;&#x2F;jobs.lever.co&#x2F;acme&#x2F;1">Apply</a> or https://boards.greenhouse.io/acme/jobs/9',
        }),
      ],
      NOW,
    );
    expect(candidates()[0]?.atsHints).toEqual(["https://boards.greenhouse.io/acme", "https://jobs.lever.co/acme"]);
  });

  it("counts existing candidates as updated, whether they changed or not", () => {
    recordCandidatesFromBoardJobs(db, "remoteok", [job()], NOW);
    const again = recordCandidatesFromBoardJobs(
      db,
      "jobicy",
      [job({ source: "jobicy", company: "ACME" }), job({ source: "jobicy", externalId: "2", company: "Acme, Inc.", descriptionHtml: "https://jobs.ashbyhq.com/acme" })],
      NOW,
    );
    expect(again).toEqual({ inserted: 0, updated: 2 });
    expect(candidates()).toHaveLength(1);
    expect(candidates()[0]).toMatchObject({ origin: "board:remoteok", atsHints: ["https://jobs.ashbyhq.com/acme"] });
  });

  it("returns zeros for no jobs", () => {
    expect(recordCandidatesFromBoardJobs(db, "remoteok", [], NOW)).toEqual({ inserted: 0, updated: 0 });
  });
});

describe("boards use the newest recorded postedAt to stop paging", () => {
  const fixture = loadFixture("himalayas/page1.json") as { jobs: Array<Record<string, unknown>> };
  const item = (id: string, pubDate: number) => ({
    ...fixture.jobs[0]!,
    guid: `https://himalayas.app/companies/x/jobs/${id}`,
    applicationLink: `https://himalayas.app/companies/x/jobs/${id}`,
    pubDate,
  });

  it("run 2 stops one page earlier than run 1", async () => {
    let generation = 1;
    const requested: string[] = [];
    const pages = (): Record<string, { jobs: unknown[]; nextCursor: string | null }> =>
      generation === 1
        ? {
            "": { jobs: [item("a", 3000)], nextCursor: "c1" },
            c1: { jobs: [item("b", 2000)], nextCursor: "c2" },
            c2: { jobs: [item("c", 1000)], nextCursor: null },
          }
        : {
            "": { jobs: [item("d", 4000), item("a", 3000)], nextCursor: "c1" },
            c1: { jobs: [item("b", 2000)], nextCursor: "c2" },
            c2: { jobs: [item("c", 1000)], nextCursor: null },
          };
    const http: HttpClient = {
      getJson: vi.fn(async (url: string) => {
        const cursor = new URL(url).searchParams.get("cursor") ?? "";
        requested.push(cursor);
        return pages()[cursor];
      }),
      getText: vi.fn(),
    };
    const adapter = createHimalayas({ sleep: async () => {} });
    const run = () => runBoardSources({ db, http, adapters: [adapter], force: true, now: () => new Date(NOW), log: () => {} });

    await run();
    expect(requested).toEqual(["", "c1", "c2"]);
    expect(db.select().from(fetchRuns).all()[0]?.latestPostedAt).toBe("1970-01-01T00:50:00.000Z"); // 3000 s

    generation = 2;
    requested.length = 0;
    await run();
    // Page 2 holds a job older than the newest one seen before, so page 3 is not requested.
    expect(requested).toEqual(["", "c1"]);
    expect(db.select().from(fetchRuns).all()[1]?.latestPostedAt).toBe("1970-01-01T01:06:40.000Z"); // 4000 s
  });
});
