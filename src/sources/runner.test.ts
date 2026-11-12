import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Job } from "@/core/job";
import { openDb } from "@/db/client";
import { fetchRuns } from "@/db/schema";
import { countJobs } from "@/db/queries";
import { runSources } from "./runner";
import { defineAdapter, type AnyAdapter } from "./types";

const RawSchema = z.object({ id: z.string() });

function fakeAdapter(
  id: "remoteok" | "jobicy",
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
      company: "Acme",
      location: null,
      remote: true,
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
    expect(countJobs(db, "remoteok")).toBe(0);
    expect(countJobs(db, "jobicy")).toBe(2);
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
      sql`CREATE TRIGGER fail_remoteok_insert BEFORE INSERT ON jobs WHEN NEW.source = 'remoteok' BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;`,
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
    expect(countJobs(db, "remoteok")).toBe(0);
    expect(countJobs(db, "jobicy")).toBe(2);
    const row = db.select().from(fetchRuns).all().find((r) => r.source === "remoteok");
    expect(row).toMatchObject({ status: "error", error: "SqliteError: simulated write failure" });
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
    expect(countJobs(db, "remoteok")).toBe(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("could not record run: SqliteError: runs table locked"));
  });
});
