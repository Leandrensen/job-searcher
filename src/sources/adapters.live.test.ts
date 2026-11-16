// Live checks: these call the real APIs. Run manually with `npm run test:live`.
// Remotive allows ~4 calls a day, so do not run this in a loop.
import { describe, expect, it } from "vitest";
import { createHttpClient } from "@/core/http";
import { runAdapter } from "./run-adapter";
import { atsAdapters, boardAdapters } from "./registry";
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
  };
  for (const adapter of atsAdapters) {
    it(
      `${adapter.id} returns valid jobs for a real company`,
      async () => {
        const company = atsCompanies[adapter.id]!;
        const result = await runAdapter(adapter, { http, latestPostedAt: null, log: console.log, companies: [company] });
        expect(result.error).toBeNull();
        expect(result.status).toBe("success");
        expect(result.jobs.length).toBeGreaterThan(0);
        expect(result.invalid / result.fetched).toBeLessThan(0.2);
      },
      120_000,
    );
  }
});
