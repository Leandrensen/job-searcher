import { describe, expect, it } from "vitest";
import { fetchRuns, jobs } from "./schema";
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
    db.insert(jobs).values({ ...baseJob, tags: ["a"], remote: true }).run();
    db.insert(fetchRuns)
      .values({ source: "remoteok", startedAt: "s", finishedAt: "f", status: "success" })
      .run();
    const job = db.select().from(jobs).get();
    expect(job?.title).toBe("Dev");
    expect(job?.tags).toEqual(["a"]);
    expect(job?.remote).toBe(true);
    expect(db.select().from(fetchRuns).get()?.fetched).toBe(0);
  });

  it("enforces unique source + external_id", () => {
    const db = openDb({ url: ":memory:", migrate: true });
    db.insert(jobs).values(baseJob).run();
    expect(() => db.insert(jobs).values(baseJob).run()).toThrow();
  });
});
