import { describe, expect, it, vi } from "vitest";
import { loadFixture } from "@/test-utils/fixtures";
import { runAdapter } from "../run-adapter";
import type { FetchContext } from "../types";
import { hnHiring } from "./hn-hiring";

const search = loadFixture("hn-hiring/search.json");
const item = loadFixture("hn-hiring/item.json") as { id: number; children: Array<Record<string, unknown>> };

function setup(searchBody: unknown = search) {
  const getJson = vi.fn<(url: string) => Promise<unknown>>(async (url) =>
    url.includes("search_by_date") ? searchBody : item,
  );
  const ctx: FetchContext = { http: { getJson, getText: vi.fn() }, latestPostedAt: null, log: () => {} };
  return { ctx, getJson };
}

const parse = (i: number) => hnHiring.normalize(hnHiring.itemSchema.parse(item.children[i]));

describe("hn-hiring adapter", () => {
  it("picks the who-is-hiring thread not who-wants-to-be-hired", async () => {
    const { ctx, getJson } = setup();
    const items = await hnHiring.fetch(ctx);
    expect(getJson).toHaveBeenCalledTimes(2);
    expect(getJson.mock.calls[0]?.[0]).toBe(
      "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=10",
    );
    expect(getJson.mock.calls[1]?.[0]).toBe(`https://hn.algolia.com/api/v1/items/${item.id}`);
    expect(items).toHaveLength(4);
  });

  it("throws when no hiring thread is found", async () => {
    const { ctx } = setup({ hits: [{ objectID: "1", title: "Ask HN: Who wants to be hired? (X)" }] });
    await expect(hnHiring.fetch(ctx)).rejects.toThrow("No Who is hiring thread found");
  });

  it("drops comments without text", async () => {
    const { ctx, getJson } = setup();
    getJson.mockImplementation(async (url) =>
      url.includes("search_by_date") ? search : { children: [...item.children, { id: 1, text: null }, { id: 2 }] },
    );
    expect(await hnHiring.fetch(ctx)).toHaveLength(4);
  });

  it("parses pipe header and normalizes a typical item", () => {
    expect(parse(0)).toEqual({
      source: "hn-hiring",
      externalId: "50338736",
      url: "https://news.ycombinator.com/item?id=50338736",
      applyUrl: "https://synteq.com/career/growth-lead",
      title: "Growth Lead & Systems Administrator",
      company: "Synteq",
      location: "Austin, TX",
      remote: true,
      tags: [],
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      descriptionHtml: expect.stringContaining("Synteq is a developer cloud"),
      descriptionText: expect.stringContaining("Synteq is a developer cloud"),
      postedAt: expect.stringMatching(/^2026-11-02T.*Z$/),
    });
  });

  it("detects remote, onsite and unknown", () => {
    expect(parse(0)?.remote).toBe(true);
    expect(parse(1)?.remote).toBe(false);
    expect(parse(2)?.remote).toBeNull();
  });

  it("decodes entities in company and title", () => {
    expect(parse(1)).toMatchObject({
      company: "University of Cambridge, University of Manchester",
      title: "PhD in AI / Earth Observation / Environmental Science",
    });
  });

  it("extracts first href as applyUrl, null when there is none", () => {
    expect(parse(0)?.applyUrl).toBe("https://synteq.com/career/growth-lead");
    expect(parse(1)?.applyUrl).toBeNull();
  });

  it("returns null without pipes", () => {
    expect(parse(3)).toBeNull();
  });

  it("separates paragraphs in the plain text", () => {
    expect(parse(0)?.descriptionText).toContain("5 US datacenters.\n");
  });

  it("counts the pipe-less post as invalid via runAdapter", async () => {
    const r = await runAdapter(hnHiring, setup().ctx);
    expect(r).toMatchObject({ status: "success", fetched: 4, invalid: 1, filtered: 0 });
    expect(r.jobs).toHaveLength(3);
  });
});
