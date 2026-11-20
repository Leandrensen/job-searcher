import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "@/core/http";
import { expectCleanText } from "@/test-utils/assertions";
import { createFixtureHttp } from "@/test-utils/fixture-http";
import { loadFixtureText } from "@/test-utils/fixtures";
import { runAdapter } from "../run-adapter";
import type { FetchContext } from "../types";
import { weworkremotely } from "./weworkremotely";
import { keywordRules } from "@/test-utils/job-filter-rules";

const BASE = "https://weworkremotely.com/categories/";
const FEED_URLS = [
  `${BASE}remote-programming-jobs.rss`,
  `${BASE}remote-full-stack-programming-jobs.rss`,
  `${BASE}remote-back-end-programming-jobs.rss`,
  `${BASE}remote-front-end-programming-jobs.rss`,
  `${BASE}remote-devops-sysadmin-jobs.rss`,
];
const routes = Object.fromEntries(FEED_URLS.map((u) => [u, "weworkremotely/programming.rss"]));
const rss = loadFixtureText("weworkremotely/programming.rss");

function ctx() {
  const http = createFixtureHttp(routes);
  const context: FetchContext = { http, latestPostedAt: null, rules: keywordRules(), log: () => {} };
  return { context, http };
}

function ctxWithGetText(getText: HttpClient["getText"]) {
  const log = vi.fn<(msg: string) => void>();
  const context: FetchContext = { http: { getJson: vi.fn(), getText }, latestPostedAt: null, rules: keywordRules(), log };
  return { context, log };
}

describe("weworkremotely adapter", () => {
  it("fetches the five category feeds one after another, in order", async () => {
    const { context, http } = ctx();
    const items = await weworkremotely.fetch(context);
    expect(http.calls).toEqual(FEED_URLS);
    expect(items).toHaveLength(15);
  });

  it("normalizes a typical item", async () => {
    const [raw] = await weworkremotely.fetch(ctx().context);
    const { descriptionHtml, descriptionText, ...rest } = weworkremotely.normalize(weworkremotely.itemSchema.parse(raw))!;
    expect(rest).toEqual({
      source: "weworkremotely",
      externalId: "https://weworkremotely.com/remote-jobs/alloy-founding-forward-deployed-engineer",
      url: "https://weworkremotely.com/remote-jobs/alloy-founding-forward-deployed-engineer",
      applyUrl: null,
      title: "Founding Forward Deployed Engineer",
      company: "Alloy",
      location: "Anywhere in the World",
      workplaceType: "remote",
      departments: [],
      regions: [],
      employmentType: null,
      tags: ["full stack programming"],
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      postedAt: "2026-10-18T07:31:05.000Z",
    });
    expect(descriptionHtml).toContain("<strong>Headquarters:</strong> New York City, Remote");
    expectCleanText(descriptionText, "Headquarters: New York City, Remote");
  });

  it("returns null when title has no company separator", () => {
    const raw = weworkremotely.itemSchema.parse({
      title: "No separator here",
      link: "https://weworkremotely.com/remote-jobs/x",
      guid: "https://weworkremotely.com/remote-jobs/x",
      pubDate: "Sun, 18 Oct 2026 07:31:05 +0000",
    });
    expect(weworkremotely.normalize(raw)).toBeNull();
  });

  it("splits only at the first colon", () => {
    const raw = weworkremotely.itemSchema.parse({
      title: "Acme: Engineer: Platform",
      link: "https://weworkremotely.com/remote-jobs/x",
      guid: "g",
      pubDate: "Sun, 18 Oct 2026 07:31:05 +0000",
    });
    expect(weworkremotely.normalize(raw)).toMatchObject({ company: "Acme", title: "Engineer: Platform" });
  });

  it("dedupes the same guid from several feeds", async () => {
    const r = await runAdapter(weworkremotely, ctx().context);
    expect(r).toMatchObject({ status: "success", fetched: 15, invalid: 0, filtered: 0 });
    expect(r.jobs).toHaveLength(3);
  });

  it("continues when one feed fails", async () => {
    let n = 0;
    const { context, log } = ctxWithGetText(
      vi.fn(async () => {
        if (n++ === 0) throw new Error("feed down");
        return rss;
      }),
    );
    const items = await weworkremotely.fetch(context);
    expect(items).toHaveLength(12);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("feed down"));
  });

  it("throws when all feeds fail", async () => {
    const { context } = ctxWithGetText(async () => {
      throw new Error("down");
    });
    await expect(weworkremotely.fetch(context)).rejects.toThrow(/All 5 feeds failed/);
  });
});
