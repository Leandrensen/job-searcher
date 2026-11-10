import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "@/core/http";
import { loadFixtureText } from "@/test-utils/fixtures";
import { runAdapter } from "../run-adapter";
import type { FetchContext } from "../types";
import { weworkremotely } from "./weworkremotely";

const rss = loadFixtureText("weworkremotely/programming.rss");

function ctxWith(getText: HttpClient["getText"]): FetchContext & { log: ReturnType<typeof vi.fn> } {
  const log = vi.fn();
  return { http: { getJson: vi.fn(), getText }, latestPostedAt: null, log };
}

describe("weworkremotely adapter", () => {
  it("fetches every feed one after another", async () => {
    const getText = vi.fn(async () => rss);
    const items = await weworkremotely.fetch(ctxWith(getText));
    expect(getText).toHaveBeenCalledTimes(5);
    expect(items).toHaveLength(15);
  });

  it("normalizes a typical item", async () => {
    const [raw] = await weworkremotely.fetch(ctxWith(async () => rss));
    expect(weworkremotely.normalize(weworkremotely.itemSchema.parse(raw))).toEqual({
      source: "weworkremotely",
      externalId: "https://weworkremotely.com/remote-jobs/alloy-founding-forward-deployed-engineer",
      url: "https://weworkremotely.com/remote-jobs/alloy-founding-forward-deployed-engineer",
      applyUrl: null,
      title: "Founding Forward Deployed Engineer",
      company: "Alloy",
      location: "Anywhere in the World",
      remote: true,
      tags: ["full stack programming"],
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      descriptionHtml: expect.stringContaining("<strong>Headquarters:</strong>"),
      descriptionText: expect.stringContaining("Headquarters: New York City, Remote"),
      postedAt: "2026-10-18T07:31:05.000Z",
    });
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

  it("dedupes the same guid from two feeds", async () => {
    const r = await runAdapter(weworkremotely, ctxWith(async () => rss));
    expect(r).toMatchObject({ status: "success", fetched: 15, invalid: 0, filtered: 0 });
    expect(r.jobs).toHaveLength(3);
  });

  it("continues when one feed fails", async () => {
    let n = 0;
    const getText = vi.fn(async () => {
      if (n++ === 0) throw new Error("feed down");
      return rss;
    });
    const ctx = ctxWith(getText);
    const items = await weworkremotely.fetch(ctx);
    expect(items).toHaveLength(12);
    expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining("feed down"));
  });

  it("throws when all feeds fail", async () => {
    await expect(
      weworkremotely.fetch(
        ctxWith(async () => {
          throw new Error("down");
        }),
      ),
    ).rejects.toThrow(/All 5 feeds failed/);
  });
});
