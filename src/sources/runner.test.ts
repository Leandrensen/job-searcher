import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Job, SourceId } from "@/core/job";
import { openDb, type Db } from "@/db/client";
import { companyCandidates, fetchRuns, jobs } from "@/db/schema";
import { runSources } from "./runner";
import { defineAdapter, type AnyAdapter } from "./types";

const RawSchema = z.object({ id: z.string() });

function fakeAdapter(
  id: SourceId,
  over: { fetch?: () => Promise<unknown[]>; minIntervalMinutes?: number } = {},
) {
  const fetchSpy = vi.fn(over.fetch ?? (async () => [{ id: "1" }, { id: "2" }]));
  const adapter = defineAdapter<z.infer<typeof RawSchema>>({
    id,
    name: id,
    homepage: "https://example.com",
    minIntervalMinutes: over.minIntervalMinutes ?? 60,
    techFilter: false,
    itemSchema: RawSchema,
    fetch: fetchSpy,
    normalize: (r): Job => ({
      source: id,
      externalId: r.id,
      url: `https://example.com/${id}/${r.id}`,
      applyUrl: null,
      title: `Developer ${r.id}`,
      company: `${id} Co ${r.id}`,
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
      postedAt: "2026-11-08T00:00:00.000Z",
    }),
  });
  return { adapter, fetchSpy };
}

const candidatesFor = (db: Db, origin: string) => db.select().from(companyCandidates).all().filter((c) => c.origin === origin);

function setup() {
  const db = openDb({ url: ":memory:", migrate: true });
  const http = { getJson: vi.fn(), getText: vi.fn() };
  let t = Date.parse("2026-11-09T12:00:00.000Z");
  const clock = { now: () => new Date(t), advanceMinutes: (m: number) => (t += m * 60_000) };
  const run = (adapters: AnyAdapter[], force = false) =>
    runSources({ db, http, adapters, force, now: clock.now, log: () => {} });
  return { db, clock, run };
}

describe("runSources", () => {
  it("skips source inside minInterval unless force", async () => {
    const { db, clock, run } = setup();
    const { adapter, fetchSpy } = fakeAdapter("remoteok", { minIntervalMinutes: 60 });

    const first = await run([adapter]);
    expect(first[0]).toMatchObject({ status: "success", fetched: 2, inserted: 2, updated: 0 });

    clock.advanceMinutes(10);
    const second = await run([adapter]);
    expect(second[0]?.status).toBe("skipped");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const forced = await run([adapter], true);
    expect(forced[0]?.status).toBe("success");
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    clock.advanceMinutes(61);
    expect((await run([adapter]))[0]?.status).toBe("success");

    const statuses = db.select().from(fetchRuns).all().map((r) => r.status);
    expect(statuses).toEqual(["success", "skipped", "success", "success"]);
  });

  it("records error run and continues with other sources", async () => {
    const { db, run } = setup();
    const bad = fakeAdapter("remoteok", {
      fetch: async () => {
        throw new Error("boom");
      },
    });
    const good = fakeAdapter("jobicy");

    const results = await run([bad.adapter, good.adapter]);
    expect(results.map((r) => [r.source, r.status])).toEqual([
      ["remoteok", "error"],
      ["jobicy", "success"],
    ]);
    expect(results[0]?.error).toBe("Error: boom");
    expect(candidatesFor(db, "board:remoteok")).toHaveLength(0);
    expect(candidatesFor(db, "board:jobicy")).toHaveLength(2);
    const runs = db.select().from(fetchRuns).all();
    expect(runs.find((r) => r.source === "remoteok")).toMatchObject({ status: "error", error: "Error: boom" });
  });

  it("second run reports inserted 0 and updated N", async () => {
    const { run } = setup();
    const { adapter } = fakeAdapter("remoteok");
    await run([adapter]);
    const second = await run([adapter], true);
    expect(second[0]).toMatchObject({ status: "success", inserted: 0, updated: 2 });
  });

  it("keeps results in adapter order with limited concurrency", async () => {
    const { run } = setup();
    const slow = fakeAdapter("remoteok", {
      fetch: async () => {
        await new Promise((r) => setTimeout(r, 30));
        return [{ id: "1" }];
      },
    });
    const fast = fakeAdapter("jobicy");
    const results = await run([slow.adapter, fast.adapter]);
    expect(results.map((r) => r.source)).toEqual(["remoteok", "jobicy"]);
  });
  it("isolates a DB write failure to its own source", async () => {
    const { db, run } = setup();
    db.run(
      sql`CREATE TRIGGER fail_remoteok_insert BEFORE INSERT ON company_candidates WHEN NEW.origin = 'board:remoteok' BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;`,
    );
    const failing = fakeAdapter("remoteok");
    const healthy = fakeAdapter("jobicy");

    const results = await run([failing.adapter, healthy.adapter]);

    expect(results.map((r) => [r.source, r.status])).toEqual([
      ["remoteok", "error"],
      ["jobicy", "success"],
    ]);
    expect(results[0]?.error).toBe("SqliteError: simulated write failure");
    expect(results[0]).toMatchObject({ fetched: 2, inserted: 0, updated: 0 });
    expect(candidatesFor(db, "board:remoteok")).toHaveLength(0);
    expect(candidatesFor(db, "board:jobicy")).toHaveLength(2);
    const row = db.select().from(fetchRuns).all().find((r) => r.source === "remoteok");
    expect(row).toMatchObject({ status: "error", error: "SqliteError: simulated write failure" });
    expect(db.select().from(jobs).all()).toEqual([]);
  });

  it("still resolves when recording the run fails", async () => {
    const { db, clock } = setup();
    db.run(
      sql`CREATE TRIGGER fail_runs BEFORE INSERT ON fetch_runs BEGIN SELECT RAISE(ABORT, 'runs table locked'); END;`,
    );
    const log = vi.fn<(m: string) => void>();
    const { adapter } = fakeAdapter("remoteok");

    const results = await runSources({
      db,
      http: { getJson: vi.fn(), getText: vi.fn() },
      adapters: [adapter],
      now: clock.now,
      log,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ status: "error", error: "SqliteError: runs table locked" });
    expect(candidatesFor(db, "board:remoteok")).toHaveLength(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("could not record run: SqliteError: runs table locked"));
  });
  it("runs at most 4 sources at once", async () => {
    const { run } = setup();
    let active = 0;
    let max = 0;
    const tracked = async () => {
      active++;
      max = Math.max(max, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active--;
      return [];
    };
    const ids: SourceId[] = ["remoteok", "weworkremotely", "workingnomads", "remotive", "himalayas", "jobicy"];

    const results = await run(ids.map((id) => fakeAdapter(id, { fetch: tracked }).adapter));

    expect(max).toBe(4);
    expect(results.map((r) => r.source)).toEqual(ids);
    expect(results.every((r) => r.status === "success")).toBe(true);
  });

  it("runs a single source alone", async () => {
    const { run } = setup();
    let active = 0;
    let max = 0;
    const { adapter } = fakeAdapter("remoteok", {
      fetch: async () => {
        active++;
        max = Math.max(max, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return [];
      },
    });
    await run([adapter]);
    expect(max).toBe(1);
  });

  it("rate guard boundary: skipped at 59 minutes, runs at exactly 60", async () => {
    const { clock, run } = setup();
    const { adapter, fetchSpy } = fakeAdapter("remoteok", { minIntervalMinutes: 60 });

    expect((await run([adapter]))[0]?.status).toBe("success");

    clock.advanceMinutes(59);
    expect((await run([adapter]))[0]?.status).toBe("skipped");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    clock.advanceMinutes(1);
    expect((await run([adapter]))[0]?.status).toBe("success");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("stores no jobs: board jobs only become company candidates", async () => {
    const { db, run } = setup();
    const { adapter } = fakeAdapter("remoteok");
    const [summary] = await run([adapter]);
    expect(summary).toMatchObject({ status: "success", fetched: 2, inserted: 2, updated: 0 });
    expect(db.select().from(jobs).all()).toEqual([]);
    expect(candidatesFor(db, "board:remoteok").map((c) => [c.name, c.status])).toEqual([
      ["remoteok Co 1", "pending"],
      ["remoteok Co 2", "pending"],
    ]);
  });

  it("counts candidates that already exist as updated", async () => {
    const { run } = setup();
    const { adapter } = fakeAdapter("remoteok");
    await run([adapter]);
    const [second] = await run([adapter], true);
    expect(second).toMatchObject({ inserted: 0, updated: 2 });
  });

  it("records the newest postedAt on the run, including jobs the tech filter dropped", async () => {
    const { db, run } = setup();
    const { adapter } = fakeAdapter("remoteok");
    // The fake titles ("Developer 1") match no tech keyword, so with the filter on nothing is kept.
    const filtered = defineAdapter({ ...(adapter as unknown as Parameters<typeof defineAdapter>[0]), techFilter: true });
    const [summary] = await run([filtered]);
    expect(summary).toMatchObject({ fetched: 2, filtered: 2, inserted: 0 });
    expect(db.select().from(fetchRuns).all()[0]?.latestPostedAt).toBe("2026-11-08T00:00:00.000Z");
    expect(candidatesFor(db, "board:remoteok")).toHaveLength(0);
  });

  it("records a null latestPostedAt for a run without dated jobs", async () => {
    const { db, run } = setup();
    const { adapter } = fakeAdapter("remoteok", { fetch: async () => [] });
    await run([adapter]);
    expect(db.select().from(fetchRuns).all()[0]?.latestPostedAt).toBeNull();
  });
});
