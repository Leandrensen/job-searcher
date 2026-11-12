import { describe, expect, it, vi } from "vitest";
import { expectCleanText } from "@/test-utils/assertions";
import { loadFixture } from "@/test-utils/fixtures";
import { runAdapter } from "../run-adapter";
import type { FetchContext } from "../types";
import { jobicy } from "./jobicy";

const fixture = loadFixture("jobicy/api.json") as { jobs: Array<Record<string, unknown> & { jobDescription: string }> };

function ctxWith(body: unknown) {
  const getJson = vi.fn(async () => body);
  const ctx: FetchContext = { http: { getJson, getText: vi.fn() }, latestPostedAt: null, log: () => {} };
  return { ctx, getJson };
}

describe("jobicy adapter", () => {
  it("fetches the dev industry with a single request", async () => {
    const { ctx, getJson } = ctxWith(fixture);
    const items = await jobicy.fetch(ctx);
    expect(items).toHaveLength(3);
    expect(getJson).toHaveBeenCalledTimes(1);
    expect(getJson).toHaveBeenCalledWith("https://jobicy.com/api/v2/remote-jobs?count=100&industry=dev");
  });

  it("throws when jobs is missing", async () => {
    await expect(jobicy.fetch(ctxWith({ success: false }).ctx)).rejects.toThrow();
  });

  it("normalizes a typical item", () => {
    const raw = jobicy.itemSchema.parse(fixture.jobs[0]);
    const { descriptionHtml, descriptionText, ...rest } = jobicy.normalize(raw)!;
    expect(rest).toEqual({
      source: "jobicy",
      externalId: "160308",
      url: "https://jobicy.com/jobs/160308-senior-ai-developer",
      applyUrl: null,
      title: "Senior AI Developer",
      company: "ClickUp",
      location: "USA",
      remote: true,
      tags: ["software engineering", "full time", "senior"],
      salaryMin: 200000,
      salaryMax: 250000,
      salaryCurrency: "USD",
      salaryPeriod: "year",
      postedAt: "2026-11-09T16:30:33.000Z",
    });
    expect(descriptionHtml).toBe(fixture.jobs[0]!.jobDescription);
    expectCleanText(descriptionText, "At ClickUp, we're building the future of work");
  });

  it("decodes entities in title", () => {
    const raw = jobicy.itemSchema.parse({ ...fixture.jobs[0], jobTitle: "R&amp;D Engineer" });
    expect(jobicy.normalize(raw)).toMatchObject({ title: "R&D Engineer" });
  });

  it("salary fields null when absent", () => {
    const raw = jobicy.itemSchema.parse(fixture.jobs[1]);
    expect(jobicy.normalize(raw)).toMatchObject({
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
    });
  });

  it("runs cleanly through the pipeline without the tech filter", async () => {
    const r = await runAdapter(jobicy, ctxWith(fixture).ctx);
    expect(r).toMatchObject({ status: "success", fetched: 3, invalid: 0, filtered: 0 });
    expect(r.jobs).toHaveLength(3);
  });
});
