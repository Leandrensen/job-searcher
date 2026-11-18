import { describe, expect, it } from "vitest";
import { createFixtureHttp, type FixtureRoute } from "@/test-utils/fixture-http";
import { atsProbes } from "@/sources/registry";
import { PROBE_ORDER, proveIdentity, resolveCandidate, type Candidate } from "./resolve";
import type { ProbeResult } from "./types";

const gh = (slug: string) => `https://boards-api.greenhouse.io/v1/boards/${slug}`;
const ghJobs = (slug: string) => `${gh(slug)}/jobs?content=true`;
const lever = (slug: string) => `https://api.lever.co/v0/postings/${slug}?mode=json`;
const ashby = (slug: string) => `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`;
const recruitee = (slug: string) => `https://${slug}.recruitee.com/api/offers/`;
const sr = (slug: string) => `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=10`;

const candidate = (over: Partial<Candidate> & { name: string }): Candidate => ({ website: null, careersUrl: null, atsHints: [], ...over });
const resolve = (c: Candidate, routes: Record<string, FixtureRoute>) => {
  const http = createFixtureHttp(routes, { fallbackStatus: 404 });
  return resolveCandidate(http, c, atsProbes).then((resolution) => ({ resolution, calls: http.calls }));
};

describe("resolveCandidate", () => {
  it("a direct careers_url link confirms after an existence check", async () => {
    const { resolution, calls } = await resolve(candidate({ name: "Acme Inc", careersUrl: "https://boards.greenhouse.io/acme" }), {
      [gh("acme")]: "resolve/gh-board-something-else.json",
      [ghJobs("acme")]: "resolve/gh-jobs-empty.json",
    });
    expect(resolution).toEqual({ status: "confirmed", ats: "greenhouse", slug: "acme", companyName: "Something Else" });
    expect(calls).toEqual([gh("acme"), ghJobs("acme")]);
  });

  it("a board-posting link confirms when identity is proven", async () => {
    const { resolution } = await resolve(candidate({ name: "Globex", atsHints: ["https://jobs.lever.co/globex"] }), {
      [lever("globex")]: "resolve/lever-globex-two.json",
    });
    expect(resolution).toMatchObject({ status: "confirmed", ats: "lever", slug: "globex" });
  });

  it("a board-posting link to another company's board is only ambiguous", async () => {
    const { resolution } = await resolve(candidate({ name: "Talentco", atsHints: ["https://jobs.lever.co/globex"] }), {
      [lever("globex")]: "resolve/lever-globex-two.json",
    });
    expect(resolution).toEqual({ status: "ambiguous", matches: [{ ats: "lever", slug: "globex" }] });
  });

  it("a careers_url link still confirms without proof", async () => {
    const { resolution } = await resolve(candidate({ name: "Talentco", careersUrl: "https://jobs.lever.co/globex" }), {
      [lever("globex")]: "resolve/lever-globex-two.json",
    });
    expect(resolution).toMatchObject({ status: "confirmed", ats: "lever", slug: "globex" });
  });

  it("a link in both careers_url and the hints is probed once", async () => {
    const { calls } = await resolve(
      candidate({ name: "Talentco", careersUrl: "https://jobs.lever.co/globex", atsHints: ["https://jobs.lever.co/globex"] }),
      { [lever("globex")]: "resolve/lever-globex-two.json" },
    );
    expect(calls.filter((u) => u === lever("globex"))).toHaveLength(1);
  });

  it("a direct smartrecruiters link needs at least one posting", async () => {
    const ok = await resolve(candidate({ name: "Bosch Group", careersUrl: "https://jobs.smartrecruiters.com/BoschGroup" }), {
      [sr("BoschGroup")]: "ats/smartrecruiters/postings-page.json",
    });
    expect(ok.resolution).toEqual({ status: "confirmed", ats: "smartrecruiters", slug: "BoschGroup", companyName: "Bosch Group" });
    expect(ok.calls).toEqual([sr("BoschGroup")]);
    const empty = await resolve(candidate({ name: "Nobody", careersUrl: "https://jobs.smartrecruiters.com/Nobody" }), {
      [sr("Nobody")]: "resolve/sr-empty.json",
    });
    expect(empty.resolution).toEqual({ status: "not_found" });
  });

  it("name match confirms on greenhouse and stops at the first confirmation", async () => {
    const { resolution, calls } = await resolve(candidate({ name: "Acme Inc" }), {
      [gh("acme")]: "resolve/gh-board-acme.json",
      [ghJobs("acme")]: "resolve/gh-jobs-empty.json",
    });
    expect(resolution).toEqual({ status: "confirmed", ats: "greenhouse", slug: "acme", companyName: "ACME" });
    expect(calls).toEqual([gh("acme"), ghJobs("acme")]);
  });

  it("lever is confirmed by the name appearing in 2 postings", async () => {
    const { resolution, calls } = await resolve(candidate({ name: "Globex" }), { [lever("globex")]: "resolve/lever-globex-two.json" });
    expect(resolution).toEqual({ status: "confirmed", ats: "lever", slug: "globex", companyName: null });
    expect(calls).toEqual([gh("globex"), lever("globex")]);
  });

  it("lever with a single posting is confirmed by the name in that posting", async () => {
    const { resolution } = await resolve(candidate({ name: "Globex" }), { [lever("globex")]: "resolve/lever-globex-one.json" });
    expect(resolution).toMatchObject({ status: "confirmed", ats: "lever", slug: "globex" });
  });

  it("lever with postings that never mention the name stays unproven", async () => {
    const { resolution } = await resolve(candidate({ name: "Globex" }), { [lever("globex")]: "resolve/lever-globex-one-unrelated.json" });
    expect(resolution).toEqual({ status: "ambiguous", matches: [{ ats: "lever", slug: "globex" }] });
  });

  it("a website domain match confirms", async () => {
    const { resolution, calls } = await resolve(candidate({ name: "Globex", website: "https://globex.com" }), {
      [recruitee("globex")]: "resolve/recruitee-globex.json",
    });
    expect(resolution).toEqual({ status: "confirmed", ats: "recruitee", slug: "globex", companyName: "Other Name" });
    expect(calls).toEqual([gh("globex"), lever("globex"), ashby("globex"), recruitee("globex")]);
  });

  it("an unproven match is ambiguous and lists the matches", async () => {
    const { resolution, calls } = await resolve(candidate({ name: "Initech" }), { [ashby("initech")]: "resolve/ashby-initech.json" });
    expect(resolution).toEqual({ status: "ambiguous", matches: [{ ats: "ashby", slug: "initech" }] });
    expect(calls).toEqual([gh("initech"), lever("initech"), ashby("initech"), recruitee("initech"), sr("initech")]);
  });

  it("an empty lever board is not found", async () => {
    const { resolution } = await resolve(candidate({ name: "Quiet" }), { [lever("quiet")]: "resolve/lever-empty.json" });
    expect(resolution).toEqual({ status: "not_found" });
  });

  it("smartrecruiters totalFound 0 is not found", async () => {
    const { resolution } = await resolve(candidate({ name: "Quiet" }), { [sr("quiet")]: "resolve/sr-empty.json" });
    expect(resolution).toEqual({ status: "not_found" });
  });

  it("a 500 on one probe and nothing else is an error, and the other probes still run", async () => {
    const { resolution, calls } = await resolve(candidate({ name: "Flaky" }), { [lever("flaky")]: { status: 500 } });
    expect(resolution.status).toBe("error");
    expect((resolution as { error: string }).error).toContain("HTTP 500");
    expect(calls).toHaveLength(PROBE_ORDER.length);
  });

  it("a probe error plus an unproven match is an error, so it is retried", async () => {
    const { resolution } = await resolve(candidate({ name: "Globex" }), {
      [gh("globex")]: { status: 500 },
      [lever("globex")]: "resolve/lever-globex-one-unrelated.json",
    });
    expect(resolution).toEqual({ status: "error", error: "HttpError: HTTP 500 for https://boards-api.greenhouse.io/v1/boards/globex" });
  });

  it("an error caused only by a 429 is marked rate limited", async () => {
    const { resolution } = await resolve(candidate({ name: "Flaky" }), { [lever("flaky")]: { status: 429 } });
    expect(resolution).toEqual({ status: "error", error: "HttpError: HTTP 429 for https://api.lever.co/v0/postings/flaky?mode=json", rateLimited: true });
  });

  it("a 429 plus another failure is a plain error", async () => {
    const { resolution } = await resolve(candidate({ name: "Flaky" }), { [gh("flaky")]: { status: 500 }, [lever("flaky")]: { status: 429 } });
    expect(resolution.status).toBe("error");
    expect("rateLimited" in resolution).toBe(false);
  });

  it("a 500 does not hide a confirmation found later", async () => {
    const { resolution } = await resolve(candidate({ name: "Globex" }), {
      [gh("globex")]: { status: 500 },
      [lever("globex")]: "resolve/lever-globex-two.json",
    });
    expect(resolution).toMatchObject({ status: "confirmed", ats: "lever" });
  });

  it("skips (ats, slug) pairs already probed through a direct link", async () => {
    const { resolution, calls } = await resolve(candidate({ name: "Acme", careersUrl: "https://boards.greenhouse.io/acme" }), {});
    expect(resolution).toEqual({ status: "not_found" });
    expect(calls).toEqual([gh("acme"), lever("acme"), ashby("acme"), recruitee("acme"), sr("acme")]);
  });

  it("tries up to three slug guesses, each against every ATS", async () => {
    const { calls } = await resolve(candidate({ name: "Acme Labs", website: "https://getacme.io" }), {});
    // guesses: acmelabs, acme-labs, getacme
    expect(calls).toHaveLength(3 * PROBE_ORDER.length); // a 404 greenhouse board is 1 call
    expect(calls.filter((u) => u === gh("getacme"))).toHaveLength(1);
  });
});

describe("proveIdentity", () => {
  const probe = (over: Partial<ProbeResult> = {}): ProbeResult => ({ exists: true, postingCount: 1, companyName: null, texts: [], urls: [], ...over });
  const acme = candidate({ name: "Acme Inc", website: "https://www.acme.io" });

  it.each<[string, Partial<ProbeResult>, boolean]>([
    ["same company name", { companyName: "ACME" }, true],
    ["name with a legal suffix", { companyName: "Acme, Inc." }, true],
    ["a different name", { companyName: "Acme Labs" }, false],
    ["url on the company domain", { urls: ["https://acme.io/jobs/1"] }, true],
    ["url on a subdomain of the company domain", { urls: ["https://careers.acme.io/o/1"] }, true],
    ["url on a look-alike domain", { urls: ["https://notacme.io/jobs/1"] }, false],
    ["domain mentioned in a posting text", { texts: ["Apply at ACME.io today"] }, true],
    ["domain inside a longer domain", { texts: ["We use notacme.io for billing"] }, false],
    ["domain followed by more labels", { texts: ["See acme.io.example.com"] }, false],
    ["domain on a subdomain in text", { texts: ["Apply at careers.acme.io/jobs"] }, true],
    ["domain at the end of a sentence", { texts: ["Learn more at acme.io."] }, true],
    ["nothing to prove it", { texts: ["We build things"], urls: ["https://jobs.example.com/1"] }, false],
  ])("%s", (_label, over, expected) => {
    expect(proveIdentity(acme, "greenhouse", probe(over))).toBe(expected);
  });

  it("a short domain does not match inside another domain", () => {
    expect(proveIdentity(candidate({ name: "X", website: "https://x.com" }), "greenhouse", probe({ texts: ["We store files on dropbox.com"] }))).toBe(false);
  });

  it("lever and ashby: the name must appear in at least 2 postings (or in the only one)", () => {
    const c = candidate({ name: "Globex" });
    expect(proveIdentity(c, "lever", probe({ texts: ["Globex rocks", "Join Globex"] }))).toBe(true);
    expect(proveIdentity(c, "lever", probe({ texts: ["Globex rocks", "Nothing here"] }))).toBe(false);
    expect(proveIdentity(c, "ashby", probe({ texts: ["Globex rocks"] }))).toBe(true);
    expect(proveIdentity(c, "ashby", probe({ texts: [] }))).toBe(false);
  });

  it("the posting-text rule ignores legal suffixes in the candidate name", () => {
    const c = candidate({ name: "Globex, Inc." });
    expect(proveIdentity(c, "lever", probe({ texts: ["At Globex we ship", "Join Globex today"] }))).toBe(true);
    expect(proveIdentity(c, "lever", probe({ texts: ["We ship widgets", "Join us today"] }))).toBe(false);
  });

  it("the posting-text rule applies to lever and ashby only", () => {
    expect(proveIdentity(candidate({ name: "Globex" }), "greenhouse", probe({ texts: ["Globex rocks", "Join Globex"] }))).toBe(false);
  });

  it("the name must match as a whole word", () => {
    expect(proveIdentity(candidate({ name: "Apple" }), "lever", probe({ texts: ["Pineapple farm", "Pineapple pizza"] }))).toBe(false);
  });
});
