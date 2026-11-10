import { describe, expect, it, vi } from "vitest";
import { loadFixture } from "@/test-utils/fixtures";
import { runAdapter } from "../run-adapter";
import type { FetchContext } from "../types";
import { arbeitnow } from "./arbeitnow";

type Page = { data: Array<Record<string, unknown>>; links: { next: string | null } };
const fixture = loadFixture("arbeitnow/page1.json") as Page;

function setup(pages: (n: number) => Page, latestPostedAt: string | null = null) {
  let n = 0;
  const getJson = vi.fn<(url: string) => Promise<unknown>>(async () => pages(++n));
  const ctx: FetchContext = { http: { getJson, getText: vi.fn() }, latestPostedAt, log: () => {} };
  return { ctx, getJson };
}

const job = (createdAt: number, slug: string) => ({ ...fixture.data[0]!, slug, created_at: createdAt });

describe("arbeitnow adapter", () => {
  it("stops paging when next is null", async () => {
    const { ctx, getJson } = setup((n) => ({ data: [job(9000 - n, `s${n}`)], links: { next: n < 2 ? "x" : null } }));
    const items = await arbeitnow.fetch(ctx);
    expect(getJson).toHaveBeenCalledTimes(2);
    expect(items).toHaveLength(2);
    expect(getJson.mock.calls.map((c) => c[0])).toEqual([
      "https://www.arbeitnow.com/api/job-board-api?page=1",
      "https://www.arbeitnow.com/api/job-board-api?page=2",
    ]);
  });

  it("stops after 3 pages", async () => {
    const { ctx, getJson } = setup((n) => ({ data: [job(9000 - n, `s${n}`)], links: { next: "x" } }));
    await arbeitnow.fetch(ctx);
    expect(getJson).toHaveBeenCalledTimes(3);
  });

  it("stops when a page reaches older jobs than latestPostedAt", async () => {
    const latest = new Date(5000 * 1000).toISOString();
    const { ctx, getJson } = setup(
      (n) => ({ data: n === 1 ? [job(6000, "a")] : [job(5500, "b"), job(4000, "c")], links: { next: "x" } }),
      latest,
    );
    const items = await arbeitnow.fetch(ctx);
    expect(getJson).toHaveBeenCalledTimes(2);
    expect(items).toHaveLength(3);
  });

  it("throws when the envelope has the wrong shape", async () => {
    const { ctx } = setup(() => ({ nope: 1 }) as unknown as Page);
    await expect(arbeitnow.fetch(ctx)).rejects.toThrow();
  });

  it("normalizes a typical item", () => {
    const raw = arbeitnow.itemSchema.parse(fixture.data[1]);
    expect(arbeitnow.normalize(raw)).toEqual({
      source: "arbeitnow",
      externalId: "remote-rust-software-engineer-rust-c-gilching-217668",
      url: expect.stringContaining("https://www.arbeitnow.com/jobs/companies/"),
      applyUrl: null,
      title: "Rust Software Engineer - Rust / C++ (m/f/d)",
      company: expect.any(String),
      location: "Remote job",
      remote: true,
      tags: ["software", "remote", "experienced", "fulltime permanent"],
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      descriptionHtml: expect.stringMatching(/^</),
      descriptionText: expect.any(String),
      postedAt: "2026-11-09T18:31:18.000Z",
    });
  });

  it("decodes escaped description html", () => {
    const raw = arbeitnow.itemSchema.parse(fixture.data[0]);
    const normalized = arbeitnow.normalize(raw);
    expect(fixture.data[0]!.description).toContain("&lt;div");
    expect(normalized?.descriptionHtml).toContain("<div");
    expect(normalized?.descriptionHtml).not.toContain("&lt;");
    expect(normalized?.descriptionText).toContain("At NiCE");
    expect(normalized?.descriptionText).not.toContain("<");
  });

  it("maps an empty location to null", () => {
    const raw = arbeitnow.itemSchema.parse(fixture.data[2]);
    expect(arbeitnow.normalize(raw)).toMatchObject({ location: null, remote: false });
  });

  it("applies the tech filter via runAdapter", async () => {
    const { ctx } = setup(() => ({ data: fixture.data, links: { next: null } }));
    const r = await runAdapter(arbeitnow, ctx);
    expect(r).toMatchObject({ status: "success", fetched: 3, invalid: 0, filtered: 1 });
  });
});
