import { describe, expect, it, vi } from "vitest";
import { HttpError, type HttpClient } from "@/core/http";
import { expectCleanText } from "@/test-utils/assertions";
import { createFixtureHttp } from "@/test-utils/fixture-http";
import { loadFixture } from "@/test-utils/fixtures";
import { runAdapter } from "../run-adapter";
import type { CompanyRef, FetchContext } from "../types";
import { greenhouse, probeGreenhouse } from "./greenhouse";

const BOARD_URL = "https://boards-api.greenhouse.io/v1/boards/mozilla";
const JOBS_URL = `${BOARD_URL}/jobs?content=true`;
const mozilla: CompanyRef = { id: 1, ats: "greenhouse", slug: "mozilla", name: "Mozilla", homeCountry: "US" };
const fixture = loadFixture("ats/greenhouse/jobs.json") as { jobs: Array<{ content: string }> };

function setup() {
  const http = createFixtureHttp({ [JOBS_URL]: "ats/greenhouse/jobs.json", [BOARD_URL]: "ats/greenhouse/board.json" });
  const ctx: FetchContext = { http, latestPostedAt: null, log: () => {}, companies: [mozilla] };
  return { http, ctx };
}

const normalizeAt = async (index: number, mutate?: (item: Record<string, unknown>) => void) => {
  const { ctx } = setup();
  const items = (await greenhouse.fetch(ctx)) as Array<{ company: CompanyRef; item: Record<string, unknown> }>;
  const wrapper = items[index]!;
  mutate?.(wrapper.item);
  return greenhouse.normalize(greenhouse.itemSchema.parse(wrapper));
};

describe("greenhouse adapter", () => {
  it("requests the exact url for each company", async () => {
    const { ctx, http } = setup();
    const items = await greenhouse.fetch(ctx);
    expect(http.calls).toEqual([JOBS_URL]);
    expect(items).toHaveLength(3);
  });

  it("throws when the envelope has the wrong shape", async () => {
    const http: HttpClient = { getJson: vi.fn(async () => ({ nope: 1 })), getText: vi.fn() };
    await expect(greenhouse.fetch({ http, latestPostedAt: null, log: () => {}, companies: [mozilla] })).rejects.toThrow();
  });

  it("throws without companies", async () => {
    const { http } = setup();
    await expect(greenhouse.fetch({ http, latestPostedAt: null, log: () => {} })).rejects.toThrow("greenhouse: no companies in context");
    await expect(greenhouse.fetch({ http, latestPostedAt: null, log: () => {}, companies: [] })).rejects.toThrow("greenhouse: no companies in context");
  });

  it("normalizes a typical item", async () => {
    const job = (await normalizeAt(0))!;
    const { descriptionHtml, descriptionText, ...rest } = job;
    expect(rest).toEqual({
      source: "greenhouse",
      externalId: "mozilla:8303335",
      url: "https://job-boards.greenhouse.io/mozilla/jobs/8303335",
      applyUrl: null,
      title: "Contract Staff Software Engineer-Bug Burndown",
      company: "Mozilla",
      location: "Remote UK",
      workplaceType: "remote",
      departments: ["Firefox"],
      regions: ["europe"],
      employmentType: null,
      tags: [],
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      postedAt: "2026-10-20T14:17:05.000Z",
    });
    expect(descriptionHtml).toContain("<p><span style=\"font-weight: 400;\">You will help reduce Firefox’s WebCompat bug backlog");
    expectCleanText(descriptionText, "You will help reduce Firefox’s WebCompat bug backlog");
  });

  it("decodes escaped content", async () => {
    const job = (await normalizeAt(0))!;
    expect(fixture.jobs[0]!.content).toContain("&lt;p&gt;");
    expect(job.descriptionHtml).not.toContain("&lt;");
    expect(job.descriptionHtml.startsWith("<p>")).toBe(true);
  });

  it("trims titles and keeps every location of a multi-location job", async () => {
    const job = (await normalizeAt(2))!;
    expect(job.title).toBe("Chief of Staff to the CEO");
    expect(job.location).toBe("Remote Canada; Remote Germany; Remote UK; Remote US");
    expect(job.regions).toEqual(["europe", "north-america"]);
    expect(job.workplaceType).toBe("remote");
    expect(job.departments).toEqual(["Mozilla Foundation"]);
  });

  it("postedAt uses first_published and never updated_at", async () => {
    const job = (await normalizeAt(0, (item) => {
      item.first_published = null;
    }))!;
    expect(job.postedAt).toBeNull();
  });

  it("remote location → remote, city-only location → onsite, empty → unknown", async () => {
    expect((await normalizeAt(0))!.workplaceType).toBe("remote");
    const city = (await normalizeAt(0, (item) => {
      item.location = { name: "San Francisco, CA" };
    }))!;
    expect(city).toMatchObject({ workplaceType: "onsite", location: "San Francisco, CA", regions: [] });
    const none = (await normalizeAt(0, (item) => {
      item.location = null;
    }))!;
    expect(none).toMatchObject({ workplaceType: null, location: null });
  });

  it("runs cleanly through the pipeline", async () => {
    const { ctx } = setup();
    const r = await runAdapter(greenhouse, ctx);
    expect(r).toMatchObject({ status: "success", fetched: 3, invalid: 0, filtered: 0 });
    expect(r.jobs.map((j) => j.externalId)).toEqual(["mozilla:8303335", "mozilla:8324482", "mozilla:8359281"]);
  });

  it("a 404 board becomes an error result naming HTTP 404", async () => {
    const http = createFixtureHttp({ [JOBS_URL]: { status: 404 } });
    const r = await runAdapter(greenhouse, { http, latestPostedAt: null, log: () => {}, companies: [mozilla] });
    expect(r.status).toBe("error");
    expect(r.error).toBe(`HttpError: HTTP 404 for ${JOBS_URL}`);
  });
});

describe("probeGreenhouse", () => {
  it("exists with name, texts and urls", async () => {
    const { http } = setup();
    const probe = await probeGreenhouse(http, "mozilla");
    expect(http.calls).toEqual([BOARD_URL, JOBS_URL]);
    expect(probe).toMatchObject({ exists: true, postingCount: 3, companyName: "Mozilla" });
    expect(probe.urls).toEqual([
      "https://job-boards.greenhouse.io/mozilla/jobs/8303335",
      "https://job-boards.greenhouse.io/mozilla/jobs/8324482",
      "https://job-boards.greenhouse.io/mozilla/jobs/8359281",
    ]);
    expect(probe.texts).toHaveLength(3);
    expectCleanText(probe.texts[0]!, "You will help reduce Firefox’s WebCompat bug backlog");
  });

  it("404 → exists false", async () => {
    const http = createFixtureHttp({ [BOARD_URL]: { status: 404 } });
    expect(await probeGreenhouse(http, "mozilla")).toEqual({ exists: false, postingCount: 0, companyName: null, texts: [], urls: [] });
  });

  it("an existing board with a 404 jobs list counts as empty", async () => {
    const http = createFixtureHttp({ [BOARD_URL]: "ats/greenhouse/board.json", [JOBS_URL]: { status: 404 } });
    expect(await probeGreenhouse(http, "mozilla")).toEqual({ exists: true, postingCount: 0, companyName: "Mozilla", texts: [], urls: [] });
  });

  it("re-throws non-404 errors", async () => {
    const http = createFixtureHttp({ [BOARD_URL]: { status: 500 } });
    const err = await probeGreenhouse(http, "mozilla").catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(500);
  });
});
