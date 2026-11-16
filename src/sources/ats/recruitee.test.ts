import { describe, expect, it, vi } from "vitest";
import { HttpError, type HttpClient } from "@/core/http";
import { expectCleanText } from "@/test-utils/assertions";
import { createFixtureHttp } from "@/test-utils/fixture-http";
import { loadFixture } from "@/test-utils/fixtures";
import { runAdapter } from "../run-adapter";
import type { CompanyRef, FetchContext } from "../types";
import { probeRecruitee, recruitee } from "./recruitee";

const URL = "https://tether.recruitee.com/api/offers/";
const tether: CompanyRef = { id: 5, ats: "recruitee", slug: "tether", name: "Tether", homeCountry: null };
const fixture = loadFixture("ats/recruitee/offers.json") as { offers: Array<{ description: string; requirements: string }> };

function setup() {
  const http = createFixtureHttp({ [URL]: "ats/recruitee/offers.json" });
  const ctx: FetchContext = { http, latestPostedAt: null, log: () => {}, companies: [tether] };
  return { http, ctx };
}

const normalizeAt = async (index: number, mutate?: (item: Record<string, unknown>) => void) => {
  const { ctx } = setup();
  const items = (await recruitee.fetch(ctx)) as Array<{ company: CompanyRef; item: Record<string, unknown> }>;
  const wrapper = items[index]!;
  mutate?.(wrapper.item);
  return recruitee.normalize(recruitee.itemSchema.parse(wrapper))!;
};

describe("recruitee adapter", () => {
  it("requests the exact url for each company", async () => {
    const { ctx, http } = setup();
    const items = await recruitee.fetch(ctx);
    expect(http.calls).toEqual([URL]);
    expect(items).toHaveLength(3);
  });

  it("throws when the envelope has the wrong shape", async () => {
    const http: HttpClient = { getJson: vi.fn(async () => ({ nope: 1 })), getText: vi.fn() };
    await expect(recruitee.fetch({ http, latestPostedAt: null, log: () => {}, companies: [tether] })).rejects.toThrow();
  });

  it("throws without companies", async () => {
    const { http } = setup();
    await expect(recruitee.fetch({ http, latestPostedAt: null, log: () => {} })).rejects.toThrow("recruitee: no companies in context");
  });

  it("normalizes a typical remote item with several locations", async () => {
    const { descriptionHtml, descriptionText, ...rest } = await normalizeAt(0);
    expect(rest).toEqual({
      source: "recruitee",
      externalId: "tether:2797907",
      url: "https://tether.recruitee.com/o/senior-nodejs-software-engineer-holepunch-100-remote-worldwide-17",
      applyUrl: "https://tether.recruitee.com/o/senior-nodejs-software-engineer-holepunch-100-remote-worldwide-17/c/new",
      title: "Senior Node.js Software Engineer - Holepunch (100% Remote, Worldwide)",
      company: "Tether",
      location:
        "Remote job | India, Bangalore | India, Chennai | India, Delhi | India, Gurgaon | India, Hyderabad | India, Pune",
      workplaceType: "remote",
      departments: ["Engineering"],
      regions: ["apac"],
      employmentType: "fulltime_permanent",
      tags: [],
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      postedAt: "2026-11-16T11:45:17.000Z",
    });
    const raw = fixture.offers[0]!;
    expect(descriptionHtml).toBe(raw.description + raw.requirements);
    expectCleanText(descriptionText, "Join Tether and Shape the Future of Digital F");
  });

  it("the hybrid flag gives a hybrid job in the UK", async () => {
    expect(await normalizeAt(1)).toMatchObject({
      title: "Financial Controller (VC or Hedge Fund- Investment Accountant)",
      workplaceType: "hybrid",
      location: "London, Greater London, United Kingdom | United Kingdom, London",
      regions: ["europe"],
      departments: ["Finance"],
    });
  });

  it("hybrid wins over remote when both flags are set", async () => {
    const job = await normalizeAt(0, (i) => void (i.hybrid = true));
    expect(job.workplaceType).toBe("hybrid");
  });

  it("falls back to the on_site flag, then to the location text", async () => {
    const onsite = await normalizeAt(0, (i) => {
      i.remote = false;
      i.hybrid = false;
      i.on_site = true;
    });
    expect(onsite.workplaceType).toBe("onsite");
    const viaText = await normalizeAt(0, (i) => {
      i.remote = null;
      i.hybrid = null;
      i.on_site = null;
      i.location = "Madrid, Spain";
      i.locations = [];
    });
    expect(viaText).toMatchObject({ workplaceType: "onsite", regions: ["europe"] });
  });

  it("published_at in the 'YYYY-MM-DD HH:MM:SS UTC' format parses, and created_at is the fallback", async () => {
    expect((await normalizeAt(2)).postedAt).toBe("2026-10-06T09:59:42.000Z");
    expect((await normalizeAt(2, (i) => void (i.published_at = null))).postedAt).toBe("2026-10-06T09:58:58.000Z");
    expect((await normalizeAt(2, (i) => void ((i.published_at = null), (i.created_at = null)))).postedAt).toBeNull();
  });

  it("salary strings are parsed, invalid numbers become null", async () => {
    const job = await normalizeAt(0, (i) => {
      i.salary = { min: "50000", max: "70000", period: "year", currency: "eur" };
    });
    expect(job).toMatchObject({ salaryMin: 50000, salaryMax: 70000, salaryCurrency: "EUR", salaryPeriod: "year" });
    const bad = await normalizeAt(0, (i) => {
      i.salary = { min: "n/a", max: 0, period: "weekly", currency: null };
    });
    expect(bad).toMatchObject({ salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null });
  });

  it("tags are normalized", async () => {
    expect((await normalizeAt(0, (i) => void (i.tags = ["Node-JS", "Master", "node js"]))).tags).toEqual(["node js", "master"]);
  });

  it("runs cleanly through the pipeline", async () => {
    const r = await runAdapter(recruitee, setup().ctx);
    expect(r).toMatchObject({ status: "success", fetched: 3, invalid: 0, filtered: 0 });
  });
});

describe("probeRecruitee", () => {
  it("exists with the company name, the posting urls and texts", async () => {
    const { http } = setup();
    const probe = await probeRecruitee(http, "tether");
    expect(http.calls).toEqual([URL]);
    expect(probe).toMatchObject({ exists: true, postingCount: 3, companyName: "Tether Operations Limited" });
    expect(probe.urls[0]).toBe("https://tether.recruitee.com/o/senior-nodejs-software-engineer-holepunch-100-remote-worldwide-17");
    expect(probe.texts).toHaveLength(3);
    expectCleanText(probe.texts[0]!, "Join Tether and Shape the Future of Digital F");
  });

  it("an empty board exists but has no company name", async () => {
    const http: HttpClient = { getJson: vi.fn(async () => ({ offers: [] })), getText: vi.fn() };
    expect(await probeRecruitee(http, "quiet")).toEqual({ exists: true, postingCount: 0, companyName: null, texts: [], urls: [] });
  });

  it("404 → exists false", async () => {
    const http = createFixtureHttp({ [URL]: { status: 404 } });
    expect(await probeRecruitee(http, "tether")).toEqual({ exists: false, postingCount: 0, companyName: null, texts: [], urls: [] });
  });

  it("re-throws non-404 errors", async () => {
    const http = createFixtureHttp({ [URL]: { status: 500 } });
    expect(await probeRecruitee(http, "tether").catch((e) => e)).toBeInstanceOf(HttpError);
  });
});
