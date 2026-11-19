import { describe, expect, it, vi } from "vitest";
import { HttpError, type HttpClient } from "@/core/http";
import { expectCleanText } from "@/test-utils/assertions";
import { createFixtureHttp } from "@/test-utils/fixture-http";
import { loadFixture } from "@/test-utils/fixtures";
import { runAdapter } from "../run-adapter";
import type { CompanyRef, FetchContext } from "../types";
import { ashby, probeAshby } from "./ashby";

const URL = "https://api.ashbyhq.com/posting-api/job-board/livekit?includeCompensation=true";
const livekit: CompanyRef = { id: 3, ats: "ashby", slug: "livekit", name: "LiveKit", homeCountry: "US" };
const fixture = loadFixture("ats/ashby/job-board.json") as { jobs: Array<Record<string, unknown> & { descriptionHtml: string }> };

function setup() {
  const http = createFixtureHttp({ [URL]: "ats/ashby/job-board.json" });
  const ctx: FetchContext = { http, latestPostedAt: null, log: () => {}, companies: [livekit] };
  return { http, ctx };
}

const normalizeAt = async (index: number, mutate?: (item: Record<string, unknown>) => void) => {
  const { ctx } = setup();
  const items = (await ashby.fetch(ctx)) as Array<{ company: CompanyRef; item: Record<string, unknown> }>;
  const wrapper = items[index]!;
  mutate?.(wrapper.item);
  return ashby.normalize(ashby.itemSchema.parse(wrapper))!;
};

describe("ashby adapter", () => {
  it("requests the exact url (with compensation) for each company", async () => {
    const { ctx, http } = setup();
    const items = await ashby.fetch(ctx);
    expect(http.calls).toEqual([URL]);
    expect(items).toHaveLength(3);
  });

  it("throws when the envelope has the wrong shape", async () => {
    const http: HttpClient = { getJson: vi.fn(async () => ({ nope: 1 })), getText: vi.fn() };
    await expect(ashby.fetch({ http, latestPostedAt: null, log: () => {}, companies: [livekit] })).rejects.toThrow();
  });

  it("throws without companies", async () => {
    const { http } = setup();
    await expect(ashby.fetch({ http, latestPostedAt: null, log: () => {} })).rejects.toThrow("ashby: no companies in context");
  });

  it("normalizes a typical remote item with a salary and a secondary location", async () => {
    const { descriptionHtml, descriptionText, ...rest } = await normalizeAt(0);
    expect(rest).toEqual({
      source: "ashby",
      externalId: "livekit:1757f49e-7e19-4c45-85f7-e4637dff66fb",
      url: "https://jobs.ashbyhq.com/livekit/1757f49e-7e19-4c45-85f7-e4637dff66fb",
      applyUrl: "https://jobs.ashbyhq.com/livekit/1757f49e-7e19-4c45-85f7-e4637dff66fb/application",
      title: "Software Engineer, Agents",
      company: "LiveKit",
      location: "North America | EMEA",
      workplaceType: "remote",
      departments: ["R&D", "Engineering"],
      regions: ["emea", "north-america"],
      employmentType: "FullTime",
      tags: [],
      salaryMin: 135000,
      salaryMax: 300000,
      salaryCurrency: "USD",
      salaryPeriod: "year",
      postedAt: "2026-08-11T00:18:10.574Z",
    });
    expect(descriptionHtml).toBe(fixture.jobs[0]!.descriptionHtml);
    expectCleanText(descriptionText, "About LiveKit");
  });

  it("an explicit Hybrid workplaceType wins over isRemote", async () => {
    const job = await normalizeAt(1);
    expect(job).toMatchObject({
      title: "Staff Developer Advocate, Community & Events",
      workplaceType: "hybrid",
      location: "San Francisco, CA (Hybrid)",
      regions: [],
      salaryMin: 210000,
      salaryMax: 284000,
      salaryCurrency: "USD",
      salaryPeriod: "year",
    });
  });

  it("combines primary and secondary locations into regions", async () => {
    expect(await normalizeAt(2)).toMatchObject({
      location: "United States (Remote) | Canada (Remote)",
      regions: ["north-america"],
      workplaceType: "remote",
      departments: ["R&D", "Trust"],
    });
  });

  it("no compensation → salary fields null", async () => {
    const job = await normalizeAt(0, (i) => void (i.compensation = null));
    expect(job).toMatchObject({ salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null });
  });

  it("a malformed compensation does not invalidate the job", async () => {
    const job = await normalizeAt(0, (i) => void (i.compensation = { compensationTiers: "oops" }));
    expect(job.salaryMin).toBeNull();
  });

  it("maps monthly and hourly salary intervals and ignores non-salary components", async () => {
    const comp = (interval: string) => ({
      compensationTiers: [
        { components: [{ compensationType: "EquityPercentage", interval: "NONE" }, { compensationType: "Salary", interval, currencyCode: "EUR", minValue: 10, maxValue: 20 }] },
      ],
    });
    expect(await normalizeAt(0, (i) => void (i.compensation = comp("1 MONTH")))).toMatchObject({ salaryMin: 10, salaryMax: 20, salaryCurrency: "EUR", salaryPeriod: "month" });
    expect((await normalizeAt(0, (i) => void (i.compensation = comp("1 HOUR")))).salaryPeriod).toBe("hour");
    expect((await normalizeAt(0, (i) => void (i.compensation = comp("1 WEEK")))).salaryPeriod).toBeNull();
  });

  it("falls back to isRemote, then to the location text", async () => {
    const viaFlag = await normalizeAt(0, (i) => {
      i.workplaceType = null;
      i.isRemote = true;
    });
    expect(viaFlag.workplaceType).toBe("remote");
    const viaText = await normalizeAt(0, (i) => {
      i.workplaceType = null;
      i.isRemote = null;
      i.location = "Berlin, Germany";
      i.secondaryLocations = [];
    });
    expect(viaText).toMatchObject({ workplaceType: "onsite", regions: ["europe"] });
  });

  it("isListed false is skipped", async () => {
    const body = { jobs: fixture.jobs.map((j, i) => (i === 1 ? { ...j, isListed: false } : j)) };
    const http: HttpClient = { getJson: vi.fn(async () => body), getText: vi.fn() };
    const items = await ashby.fetch({ http, latestPostedAt: null, log: () => {}, companies: [livekit] });
    expect(items).toHaveLength(2);
  });

  it("runs cleanly through the pipeline", async () => {
    const r = await runAdapter(ashby, setup().ctx);
    expect(r).toMatchObject({ status: "success", fetched: 3, invalid: 0, filtered: 0 });
  });
});

describe("probeAshby", () => {
  it("exists with postings, texts and urls but no company name", async () => {
    const { http } = setup();
    const probe = await probeAshby(http, "livekit");
    expect(http.calls).toEqual([URL]);
    expect(probe).toMatchObject({ exists: true, postingCount: 3, companyName: null });
    expect(probe.urls[0]).toBe("https://jobs.ashbyhq.com/livekit/1757f49e-7e19-4c45-85f7-e4637dff66fb");
    expectCleanText(probe.texts[0]!, "ABOUT LIVEKIT");
  });

  it("an empty board exists with zero postings", async () => {
    const http: HttpClient = { getJson: vi.fn(async () => ({ jobs: [] })), getText: vi.fn() };
    expect(await probeAshby(http, "empty")).toEqual({ exists: true, postingCount: 0, companyName: null, texts: [], urls: [] });
  });

  it("404 → exists false", async () => {
    const http = createFixtureHttp({ [URL]: { status: 404 } });
    expect(await probeAshby(http, "livekit")).toEqual({ exists: false, postingCount: 0, companyName: null, texts: [], urls: [] });
  });

  it("re-throws non-404 errors", async () => {
    const http = createFixtureHttp({ [URL]: { status: 500 } });
    expect(await probeAshby(http, "livekit").catch((e) => e)).toBeInstanceOf(HttpError);
  });
});
