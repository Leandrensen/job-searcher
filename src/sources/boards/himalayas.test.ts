import { describe, expect, it, vi } from "vitest";
import { loadFixture } from "@/test-utils/fixtures";
import { runAdapter } from "../run-adapter";
import type { FetchContext } from "../types";
import { createHimalayas } from "./himalayas";

type Page = { jobs: Array<Record<string, unknown>>; nextCursor?: string | null };
const fixture = loadFixture("himalayas/page1.json") as Page;

function setup(pages: (n: number) => Page, latestPostedAt: string | null = null) {
  let n = 0;
  const getJson = vi.fn<(url: string) => Promise<unknown>>(async () => pages(++n));
  const sleep = vi.fn(async () => {});
  const ctx: FetchContext = { http: { getJson, getText: vi.fn() }, latestPostedAt, log: () => {} };
  return { adapter: createHimalayas({ sleep }), ctx, getJson, sleep };
}

function jobAt(pubDate: number, id: string) {
  return { ...(fixture.jobs[0] as Record<string, unknown>), guid: `https://himalayas.app/companies/x/jobs/${id}`, pubDate };
}

describe("himalayas adapter", () => {
  it("follows nextCursor until it is missing", async () => {
    const { adapter, ctx, getJson, sleep } = setup((n) => ({ jobs: [jobAt(1000 - n, `j${n}`)], nextCursor: n < 3 ? `cur${n}` : null }));
    const items = await adapter.fetch(ctx);
    expect(items).toHaveLength(3);
    const urls = getJson.mock.calls.map((c) => c[0]);
    expect(urls[0]).toBe("https://himalayas.app/jobs/api?limit=20");
    expect(urls[1]).toBe("https://himalayas.app/jobs/api?limit=20&cursor=cur1");
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it("stops at 50 pages", async () => {
    const { adapter, ctx, getJson } = setup((n) => ({ jobs: [jobAt(5000 - n, `j${n}`)], nextCursor: `cur${n}` }));
    await adapter.fetch(ctx);
    expect(getJson).toHaveBeenCalledTimes(50);
  });

  it("stops when a page reaches older jobs than latestPostedAt", async () => {
    // latest stored = epoch 3000. Page 1 is all newer, page 2 contains an older job.
    const latest = new Date(3000 * 1000).toISOString();
    const { adapter, ctx, getJson } = setup(
      (n) => ({ jobs: n === 1 ? [jobAt(4000, "a")] : [jobAt(3500, "b"), jobAt(2000, "c")], nextCursor: `cur${n}` }),
      latest,
    );
    const items = await adapter.fetch(ctx);
    expect(getJson).toHaveBeenCalledTimes(2);
    expect(items).toHaveLength(3);
  });

  it("throws when the envelope has the wrong shape", async () => {
    const { adapter, ctx } = setup(() => ({ nope: 1 }) as unknown as Page);
    await expect(adapter.fetch(ctx)).rejects.toThrow();
  });

  it("normalizes a typical item", () => {
    const { adapter } = setup(() => fixture);
    const raw = adapter.itemSchema.parse(fixture.jobs[0]);
    expect(adapter.normalize(raw)).toEqual({
      source: "himalayas",
      externalId: expect.stringContaining("https://himalayas.app/companies/"),
      url: expect.stringContaining("https://himalayas.app/companies/"),
      applyUrl: expect.stringContaining("https://himalayas.app/"),
      title: "Java developer - Germany",
      company: expect.any(String),
      location: expect.any(String),
      remote: true,
      tags: expect.any(Array),
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      descriptionHtml: expect.any(String),
      descriptionText: expect.any(String),
      postedAt: "2026-11-09T18:15:40.000Z",
    });
  });

  it("maps salary and currency", () => {
    const { adapter } = setup(() => fixture);
    const job = adapter.normalize(adapter.itemSchema.parse(fixture.jobs[2]));
    expect(job).toMatchObject({ salaryMin: 298200, salaryMax: 368200, salaryCurrency: "USD", salaryPeriod: "year" });
  });

  it("maps hourly salary period", () => {
    const { adapter } = setup(() => fixture);
    const raw = adapter.itemSchema.parse({ ...fixture.jobs[0], minSalary: 40, maxSalary: 60, currency: "usd", salaryPeriod: "hourly" });
    expect(adapter.normalize(raw)).toMatchObject({ salaryMin: 40, salaryMax: 60, salaryCurrency: "USD", salaryPeriod: "hour" });
  });

  it("applies the tech filter via runAdapter", async () => {
    const { adapter, ctx } = setup(() => ({ jobs: fixture.jobs, nextCursor: null }));
    const r = await runAdapter(adapter, ctx);
    expect(r).toMatchObject({ status: "success", fetched: 3, invalid: 0, filtered: 1 });
  });
});
