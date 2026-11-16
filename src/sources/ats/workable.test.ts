import { describe, expect, it, vi } from "vitest";
import { HttpError, type HttpClient } from "@/core/http";
import { checkLocation } from "@/core/location-filter";
import { expectCleanText } from "@/test-utils/assertions";
import { createFixtureHttp } from "@/test-utils/fixture-http";
import { loadFixture } from "@/test-utils/fixtures";
import { runAdapter } from "../run-adapter";
import type { CompanyRef, FetchContext } from "../types";
import { probeWorkable, workable } from "./workable";

const ACCOUNT_URL = "https://apply.workable.com/api/v1/widget/accounts/modash";
const DETAILS_URL = `${ACCOUNT_URL}?details=true`;
const modash: CompanyRef = { id: 4, ats: "workable", slug: "modash", name: "Modash", homeCountry: "EE" };
// 5 rows: the same job is listed once per city (2FAA7C0BC6 twice, 538310BF21 twice, CBF05C2B71 once).
const fixture = loadFixture("ats/workable/account.json") as { jobs: Array<{ description: string }> };

function setup() {
  const http = createFixtureHttp({ [DETAILS_URL]: "ats/workable/account.json", [ACCOUNT_URL]: "ats/workable/account.json" });
  const ctx: FetchContext = { http, latestPostedAt: null, log: () => {}, companies: [modash] };
  return { http, ctx };
}

const normalizeAt = async (index: number, mutate?: (item: Record<string, unknown>) => void) => {
  const { ctx } = setup();
  const items = (await workable.fetch(ctx)) as Array<{ company: CompanyRef; item: Record<string, unknown> }>;
  const wrapper = items[index]!;
  mutate?.(wrapper.item);
  return workable.normalize(workable.itemSchema.parse(wrapper))!;
};

describe("workable adapter", () => {
  it("requests the exact url (with details) for each company", async () => {
    const { ctx, http } = setup();
    await workable.fetch(ctx);
    expect(http.calls).toEqual([DETAILS_URL]);
  });

  it("merges the per-city rows of one job into a single item", async () => {
    const { ctx } = setup();
    const items = (await workable.fetch(ctx)) as Array<{ item: { shortcode: string; extra_locations: string[] } }>;
    expect(items.map((i) => i.item.shortcode)).toEqual(["2FAA7C0BC6", "CBF05C2B71", "538310BF21"]);
    expect(items[0]!.item.extra_locations).toEqual(["Berlin, Germany"]);
    expect(items[1]!.item.extra_locations).toEqual([]);
    expect(items[2]!.item.extra_locations).toEqual(["Vilnius, Vilnius City Municipality, Lithuania"]);
  });

  it("throws when the envelope has the wrong shape", async () => {
    const http: HttpClient = { getJson: vi.fn(async () => ({ nope: 1 })), getText: vi.fn() };
    await expect(workable.fetch({ http, latestPostedAt: null, log: () => {}, companies: [modash] })).rejects.toThrow();
  });

  it("throws without companies", async () => {
    const { http } = setup();
    await expect(workable.fetch({ http, latestPostedAt: null, log: () => {} })).rejects.toThrow("workable: no companies in context");
  });

  it("normalizes a typical item with every location of the job", async () => {
    const { descriptionHtml, descriptionText, ...rest } = await normalizeAt(0);
    expect(rest).toEqual({
      source: "workable",
      externalId: "modash:2FAA7C0BC6",
      url: "https://apply.workable.com/j/2FAA7C0BC6",
      applyUrl: "https://apply.workable.com/j/2FAA7C0BC6/apply",
      title: "Senior Backend Engineer - Data Core (remote, Europe)",
      company: "Modash",
      location: "Tallinn, Harju County, Estonia | Berlin, Germany",
      workplaceType: "remote",
      departments: ["Data"],
      regions: ["europe"],
      employmentType: "Full-time",
      tags: [],
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      postedAt: "2026-10-02T00:00:00.000Z",
    });
    expect(descriptionHtml).toBe(fixture.jobs[0]!.description);
    expectCleanText(descriptionText, "Hey, I'm");
  });

  it("telecommuting true → remote; false falls back to the location text (a city is onsite)", async () => {
    expect((await normalizeAt(2)).workplaceType).toBe("remote");
    expect(await normalizeAt(1)).toMatchObject({
      title: "Technical Customer Success Manager, Toronto",
      workplaceType: "onsite",
      location: "Toronto, Ontario, Canada",
      regions: ["north-america"],
      departments: ["Customer Success"],
    });
  });

  it("an EU-only remote job is kept by the adapter but dropped by the location filter", async () => {
    const job = await normalizeAt(0);
    expect(job.regions).toEqual(["europe"]);
    expect(checkLocation(job, "US")).toEqual({ pass: false, reason: "region" });
  });

  it("postedAt falls back to created_at, then null", async () => {
    expect((await normalizeAt(0, (i) => void (i.published_on = null))).postedAt).toBe("2026-09-25T00:00:00.000Z");
    expect((await normalizeAt(0, (i) => void ((i.published_on = null), (i.created_at = null)))).postedAt).toBeNull();
  });

  it("runs cleanly through the pipeline", async () => {
    const r = await runAdapter(workable, setup().ctx);
    expect(r).toMatchObject({ status: "success", fetched: 3, invalid: 0, filtered: 0 });
    expect(r.jobs.map((j) => j.externalId)).toEqual(["modash:2FAA7C0BC6", "modash:CBF05C2B71", "modash:538310BF21"]);
  });
});

describe("probeWorkable", () => {
  it("exists with the company name and the posting count", async () => {
    const { http } = setup();
    const probe = await probeWorkable(http, "modash");
    expect(http.calls).toEqual([ACCOUNT_URL]);
    expect(probe).toMatchObject({ exists: true, postingCount: 5, companyName: "Modash" });
    expect(probe.urls[0]).toBe("https://apply.workable.com/j/2FAA7C0BC6");
  });

  it("an account with no jobs still exists and has a name", async () => {
    const http: HttpClient = { getJson: vi.fn(async () => ({ name: "Quiet Co", jobs: [] })), getText: vi.fn() };
    expect(await probeWorkable(http, "quiet")).toEqual({ exists: true, postingCount: 0, companyName: "Quiet Co", texts: [], urls: [] });
  });

  it("404 → exists false", async () => {
    const http = createFixtureHttp({ [ACCOUNT_URL]: { status: 404 } });
    expect(await probeWorkable(http, "modash")).toEqual({ exists: false, postingCount: 0, companyName: null, texts: [], urls: [] });
  });

  it("re-throws non-404 errors", async () => {
    const http = createFixtureHttp({ [ACCOUNT_URL]: { status: 500 } });
    expect(await probeWorkable(http, "modash").catch((e) => e)).toBeInstanceOf(HttpError);
  });
});
