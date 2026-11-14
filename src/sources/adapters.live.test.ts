// Live checks: these call the real APIs. Run manually with `npm run test:live`.
// Remotive allows ~4 calls a day, so do not run this in a loop.
import { describe, expect, it } from "vitest";
import { createHttpClient } from "@/core/http";
import { runAdapter } from "./run-adapter";
import { adapters } from "./registry";

const http = createHttpClient();

describe("live adapters", () => {
  for (const adapter of adapters) {
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
});
