// Live checks: these call the real APIs. Run manually with `npm run test:live`.
// Remotive allows ~4 calls a day, so do not run this in a loop.
import { describe, expect, it } from "vitest";
import { boardUrl } from "@/companies/slugs";
import { resolveCandidate } from "@/companies/resolve";
import { REMOTEINTECH_TREE_URL, YC_ALL_URL } from "@/companies/seeds";
import { createHttpClient } from "@/core/http";
import { createPacedHttpClient } from "@/core/paced-http";
import { runAdapter } from "./run-adapter";
import { atsAdapters, atsProbes, boardAdapters } from "./registry";
import type { CompanyRef } from "./types";

const http = createHttpClient();

describe("live adapters", () => {
  for (const adapter of boardAdapters) {
    it(
      `${adapter.id} returns valid jobs`,
      async () => {
        const result = await runAdapter(adapter, { http, latestPostedAt: null, log: console.log });
        expect(result.error).toBeNull();
        expect(result.status).toBe("success");
        // Remotive's free feed is tiny, so only the status is asserted for it.
        if (adapter.id === "remotive") return;
        expect(result.fetched).toBeGreaterThan(0);
        expect(result.jobs.length).toBeGreaterThan(0);
        expect(result.invalid / result.fetched).toBeLessThan(0.2);
      },
      120_000,
    );
  }

  // Real companies with open jobs, verified on 2026-11-16.
  const atsCompanies: Record<string, CompanyRef> = {
    greenhouse: { id: 1, ats: "greenhouse", slug: "mozilla", name: "Mozilla", homeCountry: "US" },
    lever: { id: 2, ats: "lever", slug: "curai", name: "Curai", homeCountry: "US" },
    ashby: { id: 3, ats: "ashby", slug: "livekit", name: "LiveKit", homeCountry: "US" },
    workable: { id: 4, ats: "workable", slug: "modash", name: "Modash", homeCountry: "EE" },
    recruitee: { id: 5, ats: "recruitee", slug: "tether", name: "Tether", homeCountry: null },
    smartrecruiters: { id: 6, ats: "smartrecruiters", slug: "BoschGroup", name: "Bosch Group", homeCountry: "DE" },
  };
  for (const adapter of atsAdapters) {
    it(
      `${adapter.id} returns valid jobs for a real company`,
      async () => {
        const company = atsCompanies[adapter.id]!;
        const result = await runAdapter(adapter, { http, latestPostedAt: null, log: console.log, companies: [company] });
        expect(result.error).toBeNull();
        expect(result.status).toBe("success");
        // SmartRecruiters ties a remote posting to one country and the adapter drops postings that fail the tech
        // and location filters before it fetches details. Almost no company has a remote tech role open to
        // Argentina or LATAM at any given time (about 45 slugs were checked on 2026-11-17, none did), so only
        // the status is asserted for it. The detail parsing is covered by the recorded fixtures.
        if (adapter.id === "smartrecruiters") return;
        expect(result.jobs.length).toBeGreaterThan(0);
        expect(result.invalid / result.fetched).toBeLessThan(0.2);
      },
      120_000,
    );
  }

  it("remoteintech tree lists more than 500 company files", async () => {
    const tree = (await http.getJson(REMOTEINTECH_TREE_URL)) as { tree: Array<{ path: string; type: string }> };
    const files = tree.tree.filter((t) => t.type === "blob" && /^src\/companies\/[^/]+\.md$/.test(t.path));
    expect(files.length).toBeGreaterThan(500);
  }, 60_000);

  it("yc dataset has more than 1000 active companies", async () => {
    const all = (await http.getJson(YC_ALL_URL)) as Array<{ status?: string }>;
    expect(all.filter((c) => c.status === "Active").length).toBeGreaterThan(1000);
  }, 120_000);

  it("probe confirms verified slugs", async () => {
    const paced = createPacedHttpClient(http);
    for (const company of Object.values(atsCompanies)) {
      const resolution = await resolveCandidate(
        paced,
        { name: company.name, website: null, careersUrl: boardUrl({ ats: company.ats, slug: company.slug }), atsHints: [] },
        atsProbes,
      );
      expect(resolution, `${company.name} should resolve to ${company.ats}/${company.slug}`).toMatchObject({
        status: "confirmed",
        ats: company.ats,
        slug: company.slug,
      });
    }
  }, 120_000);
});
