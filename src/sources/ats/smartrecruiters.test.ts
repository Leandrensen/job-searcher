import { describe, expect, it, vi } from "vitest";
import { HttpError, type HttpClient } from "@/core/http";
import { expectCleanText } from "@/test-utils/assertions";
import { createFixtureHttp } from "@/test-utils/fixture-http";
import { loadFixture } from "@/test-utils/fixtures";
import { exampleRules } from "@/test-utils/job-filter-rules";
import { runAdapter } from "../run-adapter";
import type { CompanyRef, FetchContext } from "../types";
import { probeSmartRecruiters, smartrecruiters } from "./smartrecruiters";
import { keywordRules } from "@/test-utils/job-filter-rules";

const BASE = "https://api.smartrecruiters.com/v1/companies/BoschGroup/postings";
const LIST_URL = `${BASE}?limit=100&offset=0`;
const PROBE_URL = `${BASE}?limit=10`;
const detailUrl = (id: string) => `${BASE}/${id}`;
const IDS = ["744000161904329", "744000161901889", "744000161898799"];
const [TECH_ID] = IDS as [string, string, string];

const bosch: CompanyRef = { id: 6, ats: "smartrecruiters", slug: "BoschGroup", name: "Bosch Group", homeCountry: "DE" };
const detailFixture = loadFixture(`ats/smartrecruiters/posting-${TECH_ID}.json`) as {
  jobAd: { sections: Record<string, { text: string }> };
};

const detailRoutes = Object.fromEntries(IDS.map((id) => [detailUrl(id), `ats/smartrecruiters/posting-${id}.json`]));

/** `listFixture` is postings-tech.json (one hand-edited remote full-stack posting) or postings-page.json (none match). */
function setup(listFixture = "postings-tech.json") {
  const http = createFixtureHttp({ [LIST_URL]: `ats/smartrecruiters/${listFixture}`, ...detailRoutes });
  const ctx: FetchContext = { http, latestPostedAt: null, rules: keywordRules(), log: () => {}, companies: [bosch] };
  return { http, ctx };
}

const normalizeAt = async (index: number, mutate?: (item: { list: Record<string, unknown>; detail: Record<string, unknown> }) => void) => {
  const { ctx } = setup();
  const items = (await smartrecruiters.fetch(ctx)) as Array<{ company: CompanyRef; item: { list: Record<string, unknown>; detail: Record<string, unknown> } }>;
  const wrapper = items[index]!;
  mutate?.(wrapper.item);
  return smartrecruiters.normalize(smartrecruiters.itemSchema.parse(wrapper))!;
};

describe("smartrecruiters adapter", () => {
  it("pre-filter skips detail requests for non-matching postings", async () => {
    const { ctx, http } = setup();
    const items = await smartrecruiters.fetch(ctx);
    expect(items).toHaveLength(1);
    // Only the one posting that passes the tech and location filters is fetched in detail.
    expect(http.calls).toEqual([LIST_URL, detailUrl(TECH_ID)]);
  });

  it("skips a posting whose detail request returns 404", async () => {
    const http = createFixtureHttp({ [LIST_URL]: "ats/smartrecruiters/postings-tech.json", [detailUrl(TECH_ID)]: { status: 404 } });
    const log = vi.fn<(msg: string) => void>();
    const items = await smartrecruiters.fetch({ http, latestPostedAt: null, rules: keywordRules(), log, companies: [bosch] });
    expect(items).toEqual([]);
    expect(log.mock.calls).toEqual([["smartrecruiters/BoschGroup: posting 744000161904329 is gone, skipped"]]);
  });

  it("a 500 on a detail request still fails the fetch", async () => {
    const http = createFixtureHttp({ [LIST_URL]: "ats/smartrecruiters/postings-tech.json", [detailUrl(TECH_ID)]: { status: 500 } });
    const failure = await smartrecruiters.fetch({ http, latestPostedAt: null, rules: keywordRules(), log: () => {}, companies: [bosch] }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(HttpError);
    expect((failure as HttpError).status).toBe(500);
  });

  it("pre-filters with the rules' seniority", async () => {
    const { ctx, http } = setup();
    // The fixture's only matching posting is "Senior Full-Stack Engineer", whose level is outside ["junior"].
    const items = await smartrecruiters.fetch({ ...ctx, rules: { keywords: exampleRules().keywords, seniority: ["junior"] } });
    expect(items).toEqual([]);
    expect(http.calls).toEqual([LIST_URL]);
  });

  it("makes no detail requests when nothing matches", async () => {
    const { ctx, http } = setup("postings-page.json");
    expect(await smartrecruiters.fetch(ctx)).toEqual([]);
    expect(http.calls).toEqual([LIST_URL]);
  });

  it("skips a tech posting that is not remote (location pre-filter)", async () => {
    const list = loadFixture("ats/smartrecruiters/postings-tech.json") as { content: Array<{ location: Record<string, unknown> }> };
    list.content[0]!.location = { ...list.content[0]!.location, remote: false, hybrid: false, fullLocation: "Berlin, Germany" };
    const http = createFixtureHttp({ ...detailRoutes });
    const spy = vi.spyOn(http, "getJson");
    const wrapped: HttpClient = { getJson: async (url) => (url === LIST_URL ? list : http.getJson(url)), getText: http.getText };
    const items = await smartrecruiters.fetch({ http: wrapped, latestPostedAt: null, rules: keywordRules(), log: () => {}, companies: [bosch] });
    expect(items).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports each posting the rules drop before the detail request", async () => {
    const onPrefiltered = vi.fn<(reason: "rules" | "location") => void>();
    const { ctx } = setup();
    const items = await smartrecruiters.fetch({ ...ctx, onPrefiltered });
    expect(items).toHaveLength(1);
    expect(onPrefiltered.mock.calls).toEqual([["rules"], ["rules"]]);
  });

  it("reports a posting the location pre-filter drops", async () => {
    const onPrefiltered = vi.fn<(reason: "rules" | "location") => void>();
    const list = loadFixture("ats/smartrecruiters/postings-tech.json") as { content: Array<{ location: Record<string, unknown> }> };
    list.content[0]!.location = { ...list.content[0]!.location, remote: false, hybrid: false, fullLocation: "Berlin, Germany" };
    const http = createFixtureHttp({ ...detailRoutes });
    const wrapped: HttpClient = { getJson: async (url) => (url === LIST_URL ? list : http.getJson(url)), getText: http.getText };
    await smartrecruiters.fetch({ http: wrapped, latestPostedAt: null, rules: keywordRules(), log: () => {}, companies: [bosch], onPrefiltered });
    expect(onPrefiltered.mock.calls.map((c) => c[0]).sort()).toEqual(["location", "rules", "rules"]);
  });

  it("skips a tech posting limited to another region", async () => {
    const list = loadFixture("ats/smartrecruiters/postings-tech.json") as { content: Array<{ location: Record<string, unknown> }> };
    list.content[0]!.location = { ...list.content[0]!.location, fullLocation: "Remote - US" };
    const http: HttpClient = { getJson: async () => list, getText: vi.fn() };
    expect(await smartrecruiters.fetch({ http, latestPostedAt: null, rules: keywordRules(), log: () => {}, companies: [bosch] })).toEqual([]);
  });

  it("skips tech postings at companies based in a disallowed country", async () => {
    const { http } = setup();
    const argentinian = { ...bosch, homeCountry: "AR" };
    expect(await smartrecruiters.fetch({ http, latestPostedAt: null, rules: keywordRules(), log: () => {}, companies: [argentinian] })).toEqual([]);
  });

  it("paginates until totalFound and stops at the end", async () => {
    const pages: number[] = [];
    const http: HttpClient = {
      getJson: vi.fn(async (url: string) => {
        const offset = Number(new URL(url).searchParams.get("offset"));
        pages.push(offset);
        return { offset, limit: 100, totalFound: 250, content: [] };
      }),
      getText: vi.fn(),
    };
    await smartrecruiters.fetch({ http, latestPostedAt: null, rules: keywordRules(), log: () => {}, companies: [bosch] });
    expect(pages).toEqual([0, 100, 200]);
  });

  it("lists up to 50 pages", async () => {
    const http: HttpClient = {
      getJson: vi.fn(async (url: string) => ({ offset: Number(new URL(url).searchParams.get("offset")), limit: 100, totalFound: 5000, content: [] })),
      getText: vi.fn(),
    };
    await smartrecruiters.fetch({ http, latestPostedAt: null, rules: keywordRules(), log: () => {}, companies: [bosch] });
    expect(http.getJson).toHaveBeenCalledTimes(50);
  });

  it("refuses a listing larger than it can list, before any detail request", async () => {
    const http: HttpClient = {
      getJson: vi.fn(async () => ({ offset: 0, limit: 100, totalFound: 5001, content: [] })),
      getText: vi.fn(),
    };
    await expect(smartrecruiters.fetch({ http, latestPostedAt: null, rules: keywordRules(), log: () => {}, companies: [bosch] })).rejects.toThrow(
      "smartrecruiters/BoschGroup: 5001 postings, more than the 5000 this adapter can list",
    );
    expect(http.getJson).toHaveBeenCalledTimes(1);
  });

  it("throws when the envelope has the wrong shape", async () => {
    const http: HttpClient = { getJson: vi.fn(async () => ({ nope: 1 })), getText: vi.fn() };
    await expect(smartrecruiters.fetch({ http, latestPostedAt: null, rules: keywordRules(), log: () => {}, companies: [bosch] })).rejects.toThrow();
  });

  it("throws without companies", async () => {
    const { http } = setup();
    await expect(smartrecruiters.fetch({ http, latestPostedAt: null, rules: keywordRules(), log: () => {} })).rejects.toThrow("smartrecruiters: no companies in context");
  });

  it("normalizes a typical item", async () => {
    const { descriptionHtml, descriptionText, ...rest } = await normalizeAt(0);
    expect(rest).toEqual({
      source: "smartrecruiters",
      externalId: "BoschGroup:744000161904329",
      url: "https://jobs.smartrecruiters.com/BoschGroup/744000161904329-mid-level-to-senior-technical-consultant-hcm-time-36515",
      applyUrl: "https://jobs.smartrecruiters.com/BoschGroup/744000161904329-mid-level-to-senior-technical-consultant-hcm-time-36515?oga=true",
      title: "Senior Full-Stack Engineer",
      company: "Bosch Group",
      location: "Remote - LATAM",
      workplaceType: "remote",
      departments: ["Information Technology"],
      regions: ["latam"],
      employmentType: "Full-time",
      tags: [],
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      postedAt: "2026-11-16T20:07:24.621Z",
    });
    const s = detailFixture.jobAd.sections;
    expect(descriptionHtml).toBe([s.companyDescription, s.jobDescription, s.qualifications, s.additionalInformation].map((x) => x!.text).join("\n"));
    expect(descriptionHtml).toContain("<ul><li><p>Design system architecture within the g");
    expectCleanText(descriptionText, "Na Bosch, moldamos o futuro");
  });

  it("builds the workplace type from the remote and hybrid flags", async () => {
    expect((await normalizeAt(0, (i) => void (i.list.location = { fullLocation: "X", remote: false, hybrid: true }))).workplaceType).toBe("hybrid");
    expect((await normalizeAt(0, (i) => void (i.list.location = { fullLocation: "X", remote: false, hybrid: false }))).workplaceType).toBe("onsite");
  });

  it("skips missing description sections", async () => {
    const job = await normalizeAt(0, (i) => {
      i.detail.jobAd = { sections: { jobDescription: { text: "<p>Only this</p>" } } };
    });
    expect(job.descriptionHtml).toBe("<p>Only this</p>");
  });

  it("runs cleanly through the pipeline", async () => {
    const r = await runAdapter(smartrecruiters, setup().ctx);
    expect(r).toMatchObject({ status: "success", fetched: 1, invalid: 0, filtered: 0 });
  });
});

describe("probeSmartRecruiters", () => {
  it("exists with the company name, the total and posting urls", async () => {
    const http = createFixtureHttp({ [PROBE_URL]: "ats/smartrecruiters/postings-page.json" });
    const probe = await probeSmartRecruiters(http, "BoschGroup");
    expect(http.calls).toEqual([PROBE_URL]);
    expect(probe).toEqual({
      exists: true,
      postingCount: 3,
      companyName: "Bosch Group",
      texts: [],
      urls: IDS.map((id) => `https://jobs.smartrecruiters.com/BoschGroup/${id}`),
    });
  });

  it("totalFound 0 → exists false (SmartRecruiters answers 200 for unknown slugs)", async () => {
    const http: HttpClient = { getJson: vi.fn(async () => ({ offset: 0, limit: 10, totalFound: 0, content: [] })), getText: vi.fn() };
    expect(await probeSmartRecruiters(http, "nonexistent")).toEqual({ exists: false, postingCount: 0, companyName: null, texts: [], urls: [] });
  });

  it("404 → exists false", async () => {
    const http = createFixtureHttp({ [PROBE_URL]: { status: 404 } });
    expect(await probeSmartRecruiters(http, "BoschGroup")).toEqual({ exists: false, postingCount: 0, companyName: null, texts: [], urls: [] });
  });

  it("re-throws non-404 errors", async () => {
    const http = createFixtureHttp({ [PROBE_URL]: { status: 500 } });
    expect(await probeSmartRecruiters(http, "BoschGroup").catch((e) => e)).toBeInstanceOf(HttpError);
  });
});
