import { describe, expect, it, vi } from "vitest";
import { expectCleanText } from "@/test-utils/assertions";
import { loadFixture } from "@/test-utils/fixtures";
import { runAdapter } from "../run-adapter";
import type { FetchContext } from "../types";
import { workingnomads } from "./workingnomads";

const fixture = loadFixture("workingnomads/api.json") as Array<Record<string, unknown> & { description: string }>;

function ctxWith(body: unknown) {
  const getJson = vi.fn(async () => body);
  const ctx: FetchContext = { http: { getJson, getText: vi.fn() }, latestPostedAt: null, log: () => {} };
  return { ctx, getJson };
}

describe("workingnomads adapter", () => {
  it("fetches the feed with a single request (trailing slash kept)", async () => {
    const { ctx, getJson } = ctxWith(fixture);
    const items = await workingnomads.fetch(ctx);
    expect(items).toHaveLength(3);
    expect(getJson).toHaveBeenCalledWith("https://www.workingnomads.com/api/exposed_jobs/");
  });

  it("throws when the envelope is not an array", async () => {
    await expect(workingnomads.fetch(ctxWith({ nope: 1 }).ctx)).rejects.toThrow();
  });

  it("normalizes a typical item", () => {
    const raw = workingnomads.itemSchema.parse(fixture[0]);
    const { descriptionHtml, descriptionText, ...rest } = workingnomads.normalize(raw)!;
    expect(rest).toEqual({
      source: "workingnomads",
      externalId: "2007977",
      url: "https://www.workingnomads.com/job/go/2007977/",
      applyUrl: null,
      title: "Senior SecOps Engineer",
      company: "Proxify",
      location: "Time zone: CET (+/- 3 hours)",
      remote: true,
      tags: ["security", "operations", "cloud", "audit", "compliance", "development"],
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      postedAt: "2026-11-09T13:52:38.000Z",
    });
    expect(descriptionHtml).toBe(fixture[0]!.description);
    expectCleanText(descriptionText, "About us:");
  });

  it("extracts numeric id from url", () => {
    const raw = workingnomads.itemSchema.parse(fixture[1]);
    expect(workingnomads.normalize(raw)?.externalId).toBe("2007975");
  });

  it("falls back to the full url when there is no numeric id", () => {
    const raw = workingnomads.itemSchema.parse({ ...fixture[0], url: "https://www.workingnomads.com/jobs/some-slug" });
    expect(workingnomads.normalize(raw)?.externalId).toBe("https://www.workingnomads.com/jobs/some-slug");
  });

  it("splits comma tags and tolerates empty ones", () => {
    const raw = workingnomads.itemSchema.parse({ ...fixture[0], tags: "React, node-js,,", category_name: "" });
    expect(workingnomads.normalize(raw)?.tags).toEqual(["react", "node js"]);
  });

  it("applies the tech filter via runAdapter", async () => {
    const r = await runAdapter(workingnomads, ctxWith(fixture).ctx);
    expect(r).toMatchObject({ status: "success", fetched: 3, invalid: 0, filtered: 1 });
  });
});
