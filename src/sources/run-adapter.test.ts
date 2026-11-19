import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { HttpError } from "@/core/http";
import type { Job } from "@/core/job";
import { runAdapter } from "./run-adapter";
import { defineAdapter, type FetchContext } from "./types";

const RawSchema = z.object({ id: z.string(), title: z.string() });
type Raw = z.infer<typeof RawSchema>;

function fakeJob(r: Raw): Job {
  return {
    source: "remoteok",
    externalId: r.id,
    url: `https://example.com/${r.id}`,
    applyUrl: null,
    title: r.title,
    company: "Acme",
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
  };
}

function makeAdapter(items: unknown[] | Error, opts: { techFilter?: boolean; normalize?: (r: Raw) => Job | null } = {}) {
  return defineAdapter<Raw>({
    id: "remoteok",
    name: "Fake",
    homepage: "https://example.com",
    minIntervalMinutes: 1,
    techFilter: opts.techFilter ?? false,
    itemSchema: RawSchema,
    async fetch() {
      if (items instanceof Error) throw items;
      return items;
    },
    normalize: opts.normalize ?? fakeJob,
  });
}

function ctx() {
  const log = vi.fn<(msg: string) => void>();
  const context: FetchContext = { http: { getJson: vi.fn(), getText: vi.fn() }, latestPostedAt: null, log };
  return Object.assign(context, { log });
}

describe("runAdapter", () => {
  it("returns error result when fetch throws", async () => {
    const r = await runAdapter(makeAdapter(new TypeError("boom")), ctx());
    expect(r.status).toBe("error");
    expect(r.error).toBe("TypeError: boom");
    expect(r).toMatchObject({ fetched: 0, invalid: 0, filtered: 0, jobs: [] });
  });

  it("keeps the HTTP status when fetch fails with an HttpError", async () => {
    const r = await runAdapter(makeAdapter(new HttpError(404, "https://x", "HTTP 404 for https://x")), ctx());
    expect(r).toMatchObject({ status: "error", error: "HttpError: HTTP 404 for https://x", httpStatus: 404 });
  });

  it("has no httpStatus for other errors", async () => {
    const r = await runAdapter(makeAdapter(new Error("boom")), ctx());
    expect("httpStatus" in r).toBe(false);
  });

  it("counts invalid items from schema failures", async () => {
    const c = ctx();
    const r = await runAdapter(makeAdapter([{ id: "1", title: "Dev" }, { id: 2 }, "junk"]), c);
    expect(r).toMatchObject({ status: "success", fetched: 3, invalid: 2 });
    expect(r.jobs).toHaveLength(1);
    expect(c.log).toHaveBeenCalled();
  });

  it("counts normalize null as invalid", async () => {
    const r = await runAdapter(makeAdapter([{ id: "1", title: "Dev" }], { normalize: () => null }), ctx());
    expect(r).toMatchObject({ fetched: 1, invalid: 1, jobs: [] });
  });

  it("counts jobs failing the Job schema as invalid", async () => {
    const r = await runAdapter(makeAdapter([{ id: "1", title: "" }]), ctx());
    expect(r).toMatchObject({ fetched: 1, invalid: 1, jobs: [] });
  });

  it("applies tech filter only when enabled", async () => {
    const items = [
      { id: "1", title: "Backend Developer" },
      { id: "2", title: "Account Executive" },
    ];
    const on = await runAdapter(makeAdapter(items, { techFilter: true }), ctx());
    expect(on).toMatchObject({ filtered: 1 });
    expect(on.jobs.map((j) => j.externalId)).toEqual(["1"]);
    const off = await runAdapter(makeAdapter(items, { techFilter: false }), ctx());
    expect(off).toMatchObject({ filtered: 0 });
    expect(off.jobs).toHaveLength(2);
  });

  it("dedupes repeated externalIds", async () => {
    const r = await runAdapter(
      makeAdapter([
        { id: "1", title: "First" },
        { id: "1", title: "Second" },
      ]),
      ctx(),
    );
    expect(r.fetched).toBe(2);
    expect(r.jobs).toHaveLength(1);
    expect(r.jobs[0]?.title).toBe("First");
  });

  it("reports the newest postedAt of every valid job, including filtered ones", async () => {
    const adapter = makeAdapter(
      [
        { id: "1", title: "Backend Developer" },
        { id: "2", title: "Account Executive" },
      ],
      {
        techFilter: true,
        normalize: (r) => ({ ...fakeJob(r), postedAt: r.id === "1" ? "2026-11-01T00:00:00.000Z" : "2026-11-05T00:00:00.000Z" }),
      },
    );
    const r = await runAdapter(adapter, ctx());
    expect(r.filtered).toBe(1);
    expect(r.latestPostedAt).toBe("2026-11-05T00:00:00.000Z");
  });

  it("latestPostedAt is null when no job has a date, and for failed fetches", async () => {
    expect((await runAdapter(makeAdapter([{ id: "1", title: "Dev" }]), ctx())).latestPostedAt).toBeNull();
    expect((await runAdapter(makeAdapter(new TypeError("boom")), ctx())).latestPostedAt).toBeNull();
  });
});
