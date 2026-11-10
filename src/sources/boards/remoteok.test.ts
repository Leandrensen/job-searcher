import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "@/core/http";
import { loadFixture } from "@/test-utils/fixtures";
import { runAdapter } from "../run-adapter";
import type { FetchContext } from "../types";
import { remoteok } from "./remoteok";

function ctxWith(body: unknown): FetchContext {
  const http: HttpClient = { getJson: vi.fn(async () => body), getText: vi.fn() };
  return { http, latestPostedAt: null, log: () => {} };
}

const fixture = loadFixture("remoteok/api.json");

describe("remoteok adapter", () => {
  it("fetch drops the legal notice", async () => {
    const items = await remoteok.fetch(ctxWith(fixture));
    expect(items).toHaveLength(4);
    expect(items.every((i) => typeof i === "object" && i !== null && "id" in i)).toBe(true);
  });

  it("fetch throws when the envelope is not an array", async () => {
    await expect(remoteok.fetch(ctxWith({ nope: true }))).rejects.toThrow();
  });

  it("normalizes a job with salary", async () => {
    const items = await remoteok.fetch(ctxWith(fixture));
    const raw = remoteok.itemSchema.parse(items[0]);
    expect(remoteok.normalize(raw)).toEqual({
      source: "remoteok",
      externalId: "1137691",
      url: expect.stringContaining("remoteOK.com/remote-jobs/"),
      applyUrl: expect.stringContaining("remoteOK.com"),
      title: "Feltsense AI Engineer",
      company: expect.any(String),
      location: null,
      remote: true,
      tags: expect.arrayContaining(["design"]),
      salaryMin: 60000,
      salaryMax: 110000,
      salaryCurrency: "USD",
      salaryPeriod: "year",
      descriptionHtml: expect.any(String),
      descriptionText: expect.any(String),
      postedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
    });
  });

  it("sets salary null when zero", async () => {
    const items = await remoteok.fetch(ctxWith(fixture));
    const job = remoteok.normalize(remoteok.itemSchema.parse(items[1]));
    expect(job).toMatchObject({ salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null });
  });

  it("runAdapter filters the non-tech job", async () => {
    const r = await runAdapter(remoteok, ctxWith(fixture));
    expect(r.status).toBe("success");
    expect(r).toMatchObject({ fetched: 4, invalid: 0, filtered: 1 });
    expect(r.jobs).toHaveLength(3);
  });
});
