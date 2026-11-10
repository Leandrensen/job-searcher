import { describe, expect, it, vi } from "vitest";
import { loadFixture } from "@/test-utils/fixtures";
import { runAdapter } from "../run-adapter";
import type { FetchContext } from "../types";
import { remotive } from "./remotive";

const fixture = loadFixture("remotive/api.json");

function ctxWith(body: unknown) {
  const getJson = vi.fn(async () => body);
  const ctx: FetchContext = { http: { getJson, getText: vi.fn() }, latestPostedAt: null, log: () => {} };
  return { ctx, getJson };
}

describe("remotive adapter", () => {
  it("fetches the jobs array with a single request", async () => {
    const { ctx, getJson } = ctxWith(fixture);
    const items = await remotive.fetch(ctx);
    expect(items).toHaveLength(3);
    expect(getJson).toHaveBeenCalledTimes(1);
    expect(getJson).toHaveBeenCalledWith("https://remotive.com/api/remote-jobs");
  });

  it("throws when jobs is missing", async () => {
    await expect(remotive.fetch(ctxWith({ nope: [] }).ctx)).rejects.toThrow();
  });

  it("normalizes a typical item", async () => {
    const [raw] = await remotive.fetch(ctxWith(fixture).ctx);
    expect(remotive.normalize(remotive.itemSchema.parse(raw))).toEqual({
      source: "remotive",
      externalId: "2091045",
      url: expect.stringContaining("https://remotive.com/remote-jobs/"),
      applyUrl: null,
      title: "Tier III Service Desk Engineer",
      company: "Unio Digital",
      location: "Worldwide",
      remote: true,
      tags: expect.arrayContaining(["azure", "information technology"]),
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      descriptionHtml: expect.any(String),
      descriptionText: expect.any(String),
      postedAt: "2026-11-07T01:10:55.000Z",
    });
  });

  it("naive publication_date is treated as UTC", async () => {
    const [raw] = await remotive.fetch(ctxWith(fixture).ctx);
    const job = remotive.normalize(remotive.itemSchema.parse(raw));
    expect(job?.postedAt).toBe("2026-11-07T01:10:55.000Z");
  });

  it("applies the tech filter via runAdapter", async () => {
    const r = await runAdapter(remotive, ctxWith(fixture).ctx);
    expect(r).toMatchObject({ status: "success", fetched: 3, invalid: 0, filtered: 1 });
  });

  it("has a 6 hour minimum interval (their terms allow ~4 calls a day)", () => {
    expect(remotive.minIntervalMinutes).toBe(360);
  });
});
