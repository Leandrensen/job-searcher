import { describe, expect, it, vi } from "vitest";
import { createFixtureHttp } from "@/test-utils/fixture-http";
import {
  fetchRemoteintechCandidates,
  fetchYcCandidates,
  parseFrontMatter,
  REMOTEINTECH_RAW_BASE,
  REMOTEINTECH_TREE_URL,
  YC_ALL_URL,
  ycCandidatesFrom,
} from "./seeds";
import { loadFixture } from "@/test-utils/fixtures";

const raw = (path: string) => REMOTEINTECH_RAW_BASE + path;

describe("parseFrontMatter", () => {
  it("reads simple keys and strips quotes", () => {
    expect(parseFrontMatter('---\ntitle: "Acme"\nwebsite: \'https://acme.io\'\nregion: europe\n---\nBody')).toEqual({
      title: "Acme",
      website: "https://acme.io",
      region: "europe",
    });
  });

  it("ignores nested lists and indented lines", () => {
    expect(parseFrontMatter("---\ntitle: Acme\ntechnologies:\n  - react\n  - node\nnested:\n  key: value\n---\n")).toEqual({
      title: "Acme",
      technologies: "",
      nested: "",
    });
  });

  it("stops at the first closing --- line", () => {
    expect(parseFrontMatter("---\ntitle: A\n---\ntitle: B\n---\n")).toEqual({ title: "A" });
  });

  it("handles windows line endings", () => {
    expect(parseFrontMatter("---\r\ntitle: A\r\nwebsite: https://a.io\r\n---\r\n")).toEqual({ title: "A", website: "https://a.io" });
  });

  it.each(["", "no front matter", "# Heading\n---\ntitle: A\n---"])("returns {} without front matter (%j)", (text) => {
    expect(parseFrontMatter(text)).toEqual({});
  });
});

describe("fetchRemoteintechCandidates", () => {
  const routes = {
    [REMOTEINTECH_TREE_URL]: "seed/tree.json",
    [raw("src/companies/acme.md")]: "seed/acme.md",
    [raw("src/companies/globex.md")]: "seed/globex.md",
    [raw("src/companies/no-title.md")]: "seed/no-title.md",
    [raw("src/companies/broken.md")]: { status: 404 },
  };

  it("fetches the tree, then only the company files, and maps the front matter", async () => {
    const http = createFixtureHttp(routes);
    const log = vi.fn<(m: string) => void>();
    const candidates = await fetchRemoteintechCandidates(http, log);
    expect(http.calls).toEqual([
      REMOTEINTECH_TREE_URL,
      raw("src/companies/acme.md"),
      raw("src/companies/globex.md"),
      raw("src/companies/no-title.md"),
      raw("src/companies/broken.md"),
    ]);
    expect(candidates).toEqual([
      { name: "Acme", website: "https://acme.io", careersUrl: "https://boards.greenhouse.io/acme", homeCountry: null, origin: "seed:remoteintech" },
      { name: "Globex", website: "https://globex.com", careersUrl: null, homeCountry: null, origin: "seed:remoteintech" },
    ]);
  });

  it("skips files without a title and logs a failing file", async () => {
    const log = vi.fn<(m: string) => void>();
    const candidates = await fetchRemoteintechCandidates(createFixtureHttp(routes), log);
    expect(candidates.map((c) => c.name)).toEqual(["Acme", "Globex"]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("src/companies/broken.md"));
  });

  it("warns when the tree is truncated", async () => {
    const tree = { ...(loadFixture("seed/tree.json") as object), truncated: true };
    const http = { getJson: async () => tree, getText: async () => "---\ntitle: X\n---\n" };
    const log = vi.fn<(m: string) => void>();
    await fetchRemoteintechCandidates(http, log);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/truncated/i));
  });
});

describe("ycCandidatesFrom", () => {
  it("applies the status, hiring and home-country filters and counts what it skips", () => {
    const { kept, skipped } = ycCandidatesFrom(loadFixture("seed/yc.json"));
    expect(kept).toEqual([
      { name: "Initech", website: "https://initech.example", careersUrl: null, homeCountry: "US", origin: "seed:yc" },
      { name: "Umbrella", website: "https://umbrella.example", careersUrl: null, homeCountry: "GB", origin: "seed:yc" },
      { name: "Massive Dynamic", website: "https://massive.example", careersUrl: null, homeCountry: null, origin: "seed:yc" },
    ]);
    expect(skipped).toEqual({ notActive: 1, notHiring: 1, homeCountry: 1 });
  });

  it("rejects data that is not a list", () => {
    expect(() => ycCandidatesFrom({ companies: [] })).toThrow();
  });

  it("keeps a company whose country is unknown to us", () => {
    const { kept } = ycCandidatesFrom([{ name: "X", status: "Active", isHiring: true, all_locations: "Somewhere, Atlantis" }]);
    expect(kept).toMatchObject([{ name: "X", homeCountry: null }]);
  });

  it("uses the last part of the first location", () => {
    const { kept } = ycCandidatesFrom([{ name: "Y", status: "Active", isHiring: true, all_locations: "Sydney, NSW, Australia; Remote" }]);
    expect(kept).toMatchObject([{ name: "Y", homeCountry: "AU" }]);
  });
});

describe("fetchYcCandidates", () => {
  it("downloads the dataset once", async () => {
    const http = createFixtureHttp({ [YC_ALL_URL]: "seed/yc.json" });
    const { kept } = await fetchYcCandidates(http);
    expect(http.calls).toEqual([YC_ALL_URL]);
    expect(kept).toHaveLength(3);
  });
});
