import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "@/core/http";
import { expectCleanText } from "@/test-utils/assertions";
import { createFixtureHttp } from "@/test-utils/fixture-http";
import { loadFixture } from "@/test-utils/fixtures";
import { runAdapter } from "../run-adapter";
import type { FetchContext } from "../types";
import { remoteok } from "./remoteok";
import { keywordRules } from "@/test-utils/job-filter-rules";

const URL = "https://remoteok.com/api";
// Index 0 is the legal notice, which the adapter drops.
const fixture = loadFixture("remoteok/api.json") as Array<{ description: string }>;

function ctx() {
  const http = createFixtureHttp({ [URL]: "remoteok/api.json" });
  const context: FetchContext = { http, latestPostedAt: null, rules: keywordRules(), log: () => {} };
  return { context, http };
}

describe("remoteok adapter", () => {
  it("requests only the Remote OK api url", async () => {
    const { context, http } = ctx();
    await remoteok.fetch(context);
    expect(http.calls).toEqual([URL]);
  });

  it("fetch drops the legal notice", async () => {
    const items = await remoteok.fetch(ctx().context);
    expect(items).toHaveLength(3 + 1);
    expect(items.every((i) => typeof i === "object" && i !== null && "id" in i)).toBe(true);
  });

  it("fetch throws when the envelope is not an array", async () => {
    const http: HttpClient = { getJson: vi.fn(async () => ({ nope: true })), getText: vi.fn() };
    await expect(remoteok.fetch({ http, latestPostedAt: null, rules: keywordRules(), log: () => {} })).rejects.toThrow();
  });

  it("normalizes a job with salary", async () => {
    const items = await remoteok.fetch(ctx().context);
    const { descriptionHtml, descriptionText, ...rest } = remoteok.normalize(remoteok.itemSchema.parse(items[0]))!;
    expect(rest).toEqual({
      source: "remoteok",
      externalId: "1137691",
      url: "https://remoteOK.com/remote-jobs/remote-feltsense-ai-engineer-silver-dev-1137691",
      applyUrl: "https://remoteOK.com/remote-jobs/remote-feltsense-ai-engineer-silver-dev-1137691",
      title: "Feltsense AI Engineer",
      company: "Silver.dev",
      location: null,
      workplaceType: "remote",
      departments: [],
      regions: [],
      employmentType: null,
      tags: [
        "design", "sys admin", "exec", "technical", "customer support", "dev", "testing", "javascript",
        "cloud", "postgres", "typescript", "node", "node.js", "engineer", "backend", "digital nomad",
      ],
      salaryMin: 60000,
      salaryMax: 110000,
      salaryCurrency: "USD",
      salaryPeriod: "year",
      postedAt: "2026-11-05T16:00:07.000Z",
    });
    expect(descriptionHtml).toBe(fixture[1]!.description);
    expectCleanText(descriptionText, "About the company");
  });

  it("sets salary null when zero", async () => {
    const items = await remoteok.fetch(ctx().context);
    const job = remoteok.normalize(remoteok.itemSchema.parse(items[1]));
    expect(job).toMatchObject({
      title: "UI Developer",
      company: "RainFocus",
      location: "Any State",
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
    });
  });

  it("runAdapter filters the non-tech job", async () => {
    const r = await runAdapter(remoteok, ctx().context);
    expect(r.status).toBe("success");
    expect(r).toMatchObject({ fetched: 4, invalid: 0, filtered: 1 });
    expect(r.jobs).toHaveLength(3);
  });
});
