import { describe, expect, it, vi } from "vitest";
import { HttpError, type HttpClient } from "@/core/http";
import { expectCleanText } from "@/test-utils/assertions";
import { createFixtureHttp } from "@/test-utils/fixture-http";
import { runAdapter } from "../run-adapter";
import type { CompanyRef, FetchContext } from "../types";
import { lever, probeLever } from "./lever";

const URL = "https://api.lever.co/v0/postings/curai?mode=json";
const curai: CompanyRef = { id: 2, ats: "lever", slug: "curai", name: "Curai", homeCountry: "US" };

function setup() {
  const http = createFixtureHttp({ [URL]: "ats/lever/postings.json" });
  const ctx: FetchContext = { http, latestPostedAt: null, log: () => {}, companies: [curai] };
  return { http, ctx };
}

const normalizeAt = async (index: number, mutate?: (item: Record<string, unknown>) => void) => {
  const { ctx } = setup();
  const items = (await lever.fetch(ctx)) as Array<{ company: CompanyRef; item: Record<string, unknown> }>;
  const wrapper = items[index]!;
  mutate?.(wrapper.item);
  return lever.normalize(lever.itemSchema.parse(wrapper))!;
};

describe("lever adapter", () => {
  it("requests the exact url for each company", async () => {
    const { ctx, http } = setup();
    const items = await lever.fetch(ctx);
    expect(http.calls).toEqual([URL]);
    expect(items).toHaveLength(4);
  });

  it("throws when the envelope is not an array", async () => {
    const http: HttpClient = { getJson: vi.fn(async () => ({ nope: 1 })), getText: vi.fn() };
    await expect(lever.fetch({ http, latestPostedAt: null, log: () => {}, companies: [curai] })).rejects.toThrow();
  });

  it("throws without companies", async () => {
    const { http } = setup();
    await expect(lever.fetch({ http, latestPostedAt: null, log: () => {} })).rejects.toThrow("lever: no companies in context");
  });

  it("normalizes a typical item with a salary range", async () => {
    const { descriptionHtml, descriptionText, ...rest } = await normalizeAt(2);
    expect(rest).toEqual({
      source: "lever",
      externalId: "curai:46e0dd2f-c1dd-4ca2-9095-5b45f477b656",
      url: "https://jobs.lever.co/curai/46e0dd2f-c1dd-4ca2-9095-5b45f477b656",
      applyUrl: "https://jobs.lever.co/curai/46e0dd2f-c1dd-4ca2-9095-5b45f477b656/apply",
      title: "Senior Software Engineer, Full-Stack",
      company: "Curai",
      location: "Remote",
      workplaceType: "remote",
      departments: ["Engineering", "Product Engineering"],
      regions: [],
      employmentType: "W2",
      tags: [],
      salaryMin: 175000,
      salaryMax: 210000,
      salaryCurrency: "USD",
      salaryPeriod: "year",
      postedAt: "2026-09-30T18:18:01.515Z",
    });
    expect(descriptionHtml).toContain("<h3>About the Senior Full-Stack Software Engineer</h3><ul>");
    expect(descriptionHtml).toContain("<h3>What You'll Need</h3><ul>");
    expectCleanText(descriptionText, "At Curai, we believe that access to high-quality healthcare is a funda");
  });

  it("createdAt in milliseconds gives the right ISO date", async () => {
    expect((await normalizeAt(0)).postedAt).toBe("2026-11-16T15:59:52.119Z");
  });

  it("no salaryRange → salary fields null", async () => {
    expect(await normalizeAt(0)).toMatchObject({ salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null, employmentType: null });
  });

  it("maps salary intervals", async () => {
    const monthly = await normalizeAt(2, (i) => {
      i.salaryRange = { min: 4000, max: 5000, currency: "eur", interval: "per-month-salary" };
    });
    expect(monthly).toMatchObject({ salaryMin: 4000, salaryMax: 5000, salaryCurrency: "EUR", salaryPeriod: "month" });
    const odd = await normalizeAt(2, (i) => {
      i.salaryRange = { min: 1, max: 2, currency: "USD", interval: "per-week-salary" };
    });
    expect(odd.salaryPeriod).toBeNull();
  });

  it("an 'unspecified' workplaceType falls back to the location text", async () => {
    const city = await normalizeAt(0, (i) => {
      i.workplaceType = "unspecified";
      i.categories = { location: "San Francisco, CA", allLocations: ["San Francisco, CA"] };
    });
    expect(city).toMatchObject({ workplaceType: "onsite", location: "San Francisco, CA" });
    const remoteText = await normalizeAt(0, (i) => {
      i.workplaceType = null;
      i.categories = { location: "Remote - LATAM", allLocations: ["Remote - LATAM", "Remote - US"] };
    });
    expect(remoteText).toMatchObject({ workplaceType: "remote", regions: ["latam", "north-america"], location: "Remote - LATAM | Remote - US" });
  });

  it("keeps a hybrid workplaceType", async () => {
    expect((await normalizeAt(0, (i) => void (i.workplaceType = "hybrid"))).workplaceType).toBe("hybrid");
  });

  it("runs cleanly through the pipeline", async () => {
    const r = await runAdapter(lever, setup().ctx);
    expect(r).toMatchObject({ status: "success", fetched: 4, invalid: 0, filtered: 0 });
  });
});

describe("probeLever", () => {
  it("exists with postings, texts and urls but no company name", async () => {
    const { http } = setup();
    const probe = await probeLever(http, "curai");
    expect(http.calls).toEqual([URL]);
    expect(probe).toMatchObject({ exists: true, postingCount: 4, companyName: null });
    expect(probe.urls[0]).toBe("https://jobs.lever.co/curai/d081ee63-b111-4e3b-8b73-d56a30e6fcb4");
    expect(probe.texts).toHaveLength(4);
    expectCleanText(probe.texts[0]!, "At Curai, we believe");
  });

  it("an empty board exists with zero postings", async () => {
    const http: HttpClient = { getJson: vi.fn(async () => []), getText: vi.fn() };
    expect(await probeLever(http, "empty")).toEqual({ exists: true, postingCount: 0, companyName: null, texts: [], urls: [] });
  });

  it("404 → exists false", async () => {
    const http = createFixtureHttp({ [URL]: { status: 404 } });
    expect(await probeLever(http, "curai")).toEqual({ exists: false, postingCount: 0, companyName: null, texts: [], urls: [] });
  });

  it("re-throws non-404 errors", async () => {
    const http = createFixtureHttp({ [URL]: { status: 503 } });
    expect(await probeLever(http, "curai").catch((e) => e)).toBeInstanceOf(HttpError);
  });
});
