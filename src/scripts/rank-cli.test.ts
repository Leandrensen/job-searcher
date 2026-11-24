import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "@/core/job";
import { openDb, type Db } from "@/db/client";
import { insertOrGetCompany } from "@/db/companies";
import { markClosedJobs, upsertJobs } from "@/db/queries";
import type { Embedder } from "@/ranking/embedder";
import { createFakeEmbedder } from "@/test-utils/fake-embedder";
import { runRankCli } from "./rank-cli";

const NOW = new Date("2026-11-19T12:00:00.000Z");

function job(externalId: string, title: string, description: string): Job {
  return {
    source: "greenhouse",
    externalId,
    url: `https://example.com/${externalId}`,
    applyUrl: null,
    title,
    company: "Acme",
    location: "Remote",
    workplaceType: "remote",
    departments: [],
    regions: [],
    employmentType: null,
    tags: [],
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    descriptionHtml: "",
    descriptionText: description,
    postedAt: null,
  };
}

let dir: string;
const writeRules = (rules: unknown) => fs.writeFileSync(path.join(dir, "job-filter-rules.json"), JSON.stringify(rules));
let db: Db;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "m3-"));
  fs.writeFileSync(path.join(dir, "search.md"), "React and Node developer\n");
  writeRules({ keywords: ["developer", "engineer"] });
  db = openDb({ url: ":memory:", migrate: true });
  const acme = insertOrGetCompany(db, { ats: "greenhouse", slug: "acme", name: "Acme", website: null, homeCountry: null, origin: "manual" }, NOW.toISOString());
  upsertJobs(
    db,
    [
      job("acme:a", "Senior React Developer", "React and Node"),
      job("acme:b", "Senior Python Developer", "Python"),
      job("acme:c", "Senior Node Engineer", "Node"),
      job("acme:d", "Mobile Developer", "React"),
      job("acme:e", "Closed React Developer", "React"),
    ],
    NOW.toISOString(),
    { companyId: acme },
  );
  markClosedJobs(db, acme, ["acme:a", "acme:b", "acme:c", "acme:d"], NOW.toISOString()); // closes acme:e
});

function setup(over: { embedder?: Embedder; openDb?: () => Db; createEmbedder?: () => Promise<Embedder> } = {}) {
  const logs: string[] = [];
  const errors: string[] = [];
  const tables: Array<Array<Record<string, string | number>>> = [];
  const openDbSpy = vi.fn(over.openDb ?? (() => db));
  const embedder = over.embedder ?? createFakeEmbedder();
  const createEmbedder = vi.fn(over.createEmbedder ?? (async () => embedder));
  const run = (argv: string[] = []) =>
    runRankCli(argv, {
      openDb: openDbSpy,
      createEmbedder,
      configDir: dir,
      now: () => NOW,
      out: { log: (m) => logs.push(m), error: (m) => errors.push(m), table: (rows) => tables.push(rows) },
    });
  return { logs, errors, tables, openDbSpy, createEmbedder, run };
}

describe("runRankCli", () => {
  it("ranks every open job", async () => {
    const { logs, tables, run } = setup();
    expect(await run()).toBe(0);
    expect(logs).toContain("Open jobs: 4");
    expect(logs).toContain("Embedded 4 new or changed jobs, reused 0");
    // "Mobile Developer" (react) and "Senior Node Engineer" (node) are both about 0.707 from the search; the fake
    // embedder's tiny per-axis offset puts "Mobile Developer" fractionally ahead.
    expect(tables[0]!.map((r) => r.title)).toEqual(["Senior React Developer", "Mobile Developer", "Senior Node Engineer", "Senior Python Developer"]);
    expect(tables[0]![0]).toMatchObject({ rank: 1, company: "Acme", location: "Remote", url: "https://example.com/acme:a" });
    expect(logs.at(-1)).toBe("Showing 4 of 4");
  });

  it("a second run reuses every embedding", async () => {
    await setup().run();
    const second = setup();
    await second.run();
    expect(second.logs).toContain("Embedded 0 new or changed jobs, reused 4");
  });

  it("--top 1 shows one job", async () => {
    const { logs, tables, run } = setup();
    await run(["--top", "1"]);
    expect(tables[0]).toHaveLength(1);
    expect(logs.at(-1)).toBe("Showing 1 of 4");
  });

  it("a missing search.md fails before opening the DB", async () => {
    fs.rmSync(path.join(dir, "search.md"));
    const { errors, openDbSpy, createEmbedder, run } = setup();
    expect(await run()).toBe(1);
    expect(errors).toEqual(["Missing config/search.md. Copy config/search.example.md to config/search.md and describe the job you want."]);
    expect(openDbSpy).not.toHaveBeenCalled();
    expect(createEmbedder).not.toHaveBeenCalled();
  });

  it("no open jobs returns 0 without loading the model", async () => {
    const empty = openDb({ url: ":memory:", migrate: true });
    const { logs, createEmbedder, run } = setup({ openDb: () => empty });
    expect(await run()).toBe(0);
    expect(logs).toEqual(["No open jobs to rank. Run npm run fetch first."]);
    expect(createEmbedder).not.toHaveBeenCalled();
  });

  it("skips open jobs that fail the current rules", async () => {
    writeRules({ keywords: ["developer", "engineer"], excludeTitleKeywords: ["Mobile"] });
    const { logs, tables, run } = setup();
    expect(await run()).toBe(0);
    expect(logs).toContain("Skipped by the current job filter rules: 1");
    expect(logs).toContain("Open jobs: 3");
    expect(logs).toContain("Embedded 3 new or changed jobs, reused 0");
    expect(tables[0]!.map((r) => r.title)).toEqual(["Senior React Developer", "Senior Node Engineer", "Senior Python Developer"]);
    expect(logs.at(-1)).toBe("Showing 3 of 3");
  });

  it("every open job failing the rules returns 0 without loading the model", async () => {
    writeRules({ keywords: ["rust"] });
    const { logs, createEmbedder, run } = setup();
    expect(await run()).toBe(0);
    expect(logs).toEqual(["Skipped by the current job filter rules: 4", "No open jobs pass the current job filter rules."]);
    expect(createEmbedder).not.toHaveBeenCalled();
  });

  it("a copy that passes the rules is ranked when the lowest-id copy fails", async () => {
    // A Lever copy of acme:d (so a duplicate of it) whose tags match the rules, while acme:d itself doesn't.
    upsertJobs(db, [{ ...job("lever:m", "Mobile Developer", "React"), source: "lever", tags: ["react"] }], NOW.toISOString());
    writeRules({ keywords: ["react"] });
    const { logs, tables, run } = setup();
    expect(await run()).toBe(0);
    expect(logs).toContain("Skipped by the current job filter rules: 3");
    expect(logs).toContain("Open jobs: 2");
    expect(tables[0]!.map((r) => r.url).sort()).toEqual(["https://example.com/acme:a", "https://example.com/lever:m"]);
  });

  it("uses the example rules when the personal file is missing", async () => {
    fs.rmSync(path.join(dir, "job-filter-rules.json"));
    fs.copyFileSync("config/job-filter-rules.example.json", path.join(dir, "job-filter-rules.example.json"));
    const { logs, run } = setup();
    expect(await run()).toBe(0);
    expect(logs).toContain("No config/job-filter-rules.json: using config/job-filter-rules.example.json");
    // Under the example rules, Python has no keyword and Mobile is an excluded title word.
    expect(logs).toContain("Skipped by the current job filter rules: 2");
    expect(logs).toContain("Open jobs: 2");
  });

  it("missing rule files fail before opening the DB", async () => {
    fs.rmSync(path.join(dir, "job-filter-rules.json"));
    const { errors, openDbSpy, run } = setup();
    expect(await run()).toBe(1);
    expect(errors).toEqual(["Missing config/job-filter-rules.json and config/job-filter-rules.example.json."]);
    expect(openDbSpy).not.toHaveBeenCalled();
  });

  it("invalid rules fail before opening the DB", async () => {
    writeRules({ keywords: [] });
    const { errors, openDbSpy, run } = setup();
    expect(await run()).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^config\/job-filter-rules\.json: keywords: /);
    expect(openDbSpy).not.toHaveBeenCalled();
  });

  it("a model that fails to load returns 1", async () => {
    const { errors, run } = setup({ createEmbedder: async () => Promise.reject(new Error("download failed")) });
    expect(await run()).toBe(1);
    expect(errors).toEqual(["Could not load the embedding model: Error: download failed"]);
  });

  it("a failure while embedding jobs is labelled as ranking", async () => {
    // Call 0 embeds the search; call 1 is the first batch of jobs.
    const { errors, run } = setup({ embedder: createFakeEmbedder({ fail: (i) => i === 1 }) });
    expect(await run()).toBe(1);
    expect(errors).toEqual(["Ranking failed: Error: model crashed"]);
  });

  it.each([
    [["--top"], "Missing or invalid value for --top"],
    [["--top", "0"], "Missing or invalid value for --top"],
    [["--top", "x"], "Missing or invalid value for --top"],
    [["--bogus"], "Unknown option: --bogus"],
  ])("rejects bad arguments %j", async (argv, message) => {
    const { errors, openDbSpy, run } = setup();
    expect(await run(argv)).toBe(1);
    expect(errors).toEqual([message]);
    expect(openDbSpy).not.toHaveBeenCalled();
  });
});
