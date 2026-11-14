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
});
