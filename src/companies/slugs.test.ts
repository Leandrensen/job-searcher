import { describe, expect, it } from "vitest";
import { boardUrl, extractAtsRefs, parseAtsUrl, slugGuesses, websiteDomain, type AtsRef } from "./slugs";

describe("parseAtsUrl", () => {
  it.each<[string, AtsRef | null]>([
    ["https://boards.greenhouse.io/Acme/jobs/123", { ats: "greenhouse", slug: "acme" }],
    ["https://job-boards.greenhouse.io/acme", { ats: "greenhouse", slug: "acme" }],
    ["https://boards.greenhouse.io/embed/job_app?for=acme&token=1", { ats: "greenhouse", slug: "acme" }],
    ["https://jobs.lever.co/weloglobal./abc", { ats: "lever", slug: "weloglobal" }],
    // EU boards live on other API hosts that the probes and adapters don't call, so they are not trusted.
    ["https://jobs.eu.lever.co/acme/", null],
    ["https://job-boards.eu.greenhouse.io/acme/jobs/1", null],
    ["https://jobs.ashbyhq.com/livekit/uuid", { ats: "ashby", slug: "livekit" }],
    ["https://tether.recruitee.com/o/x", { ats: "recruitee", slug: "tether" }],
    ["https://www.recruitee.com/pricing", null],
    ["https://jobs.smartrecruiters.com/BoschGroup/123", { ats: "smartrecruiters", slug: "BoschGroup" }],
    ["https://example.com/careers", null],
  ])("%s", (url, expected) => {
    expect(parseAtsUrl(url)).toEqual(expected);
  });
});

describe("extractAtsRefs", () => {
  it("finds unique refs in escaped html, in order of appearance", () => {
    const text =
      'Apply at <a href="https:&#x2F;&#x2F;jobs.lever.co&#x2F;acme&#x2F;1">here</a> or https://jobs.lever.co/acme/2 ' +
      "or https://boards.greenhouse.io/globex";
    expect(extractAtsRefs(text)).toEqual([
      { ats: "lever", slug: "acme" },
      { ats: "greenhouse", slug: "globex" },
    ]);
  });

  it("handles backslash-escaped slashes and returns nothing for plain text", () => {
    expect(extractAtsRefs("https:\\/\\/jobs.ashbyhq.com\\/livekit")).toEqual([{ ats: "ashby", slug: "livekit" }]);
    expect(extractAtsRefs("no links here")).toEqual([]);
  });
});

describe("websiteDomain", () => {
  it.each<[string | null | undefined, string | null]>([
    ["https://www.Acme.io/about", "acme.io"],
    ["acme.io", "acme.io"],
    ["not a url", null],
    [null, null],
    [undefined, null],
  ])("%j → %j", (url, expected) => {
    expect(websiteDomain(url)).toBe(expected);
  });
});

describe("slugGuesses", () => {
  it.each<[string, string | null, string[]]>([
    ["Acme Labs, Inc.", "https://acmelabs.io", ["acmelabs", "acme-labs"]],
    ["Silver.dev", null, ["silverdev", "silver-dev"]],
    ["AT&T", null, ["atandt", "at-and-t"]],
    ["Globex", "https://www.globex.com", ["globex"]],
    ["Quantum-Systems GmbH", "https://quantum-systems.com", ["quantumsystems", "quantum-systems"]],
    ["Acme", "https://getacme.com", ["acme", "getacme"]],
    ["X", "https://x.io", ["x"]],
  ])("%j + %j → %j", (name, website, expected) => {
    expect(slugGuesses(name, website)).toEqual(expected);
  });

  it("returns at most 3 guesses", () => {
    expect(slugGuesses("Foo Bar", "https://foobarapp.com").length).toBeLessThanOrEqual(3);
  });
});

describe("boardUrl", () => {
  it.each<[AtsRef, string]>([
    [{ ats: "greenhouse", slug: "acme" }, "https://boards.greenhouse.io/acme"],
    [{ ats: "lever", slug: "acme" }, "https://jobs.lever.co/acme"],
    [{ ats: "ashby", slug: "acme" }, "https://jobs.ashbyhq.com/acme"],
    [{ ats: "recruitee", slug: "acme" }, "https://acme.recruitee.com"],
    [{ ats: "smartrecruiters", slug: "BoschGroup" }, "https://jobs.smartrecruiters.com/BoschGroup"],
  ])("%j → %s", (ref, url) => {
    expect(boardUrl(ref)).toBe(url);
  });

  it("round-trips through parseAtsUrl", () => {
    for (const ats of ["greenhouse", "lever", "ashby", "recruitee", "smartrecruiters"] as const) {
      expect(parseAtsUrl(boardUrl({ ats, slug: "Acme" }))).toEqual({ ats, slug: ats === "smartrecruiters" ? "Acme" : "acme" });
    }
  });
});
