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
let db: Db;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "m3-"));
  fs.writeFileSync(path.join(dir, "search.md"), "React and Node developer\n");
  fs.writeFileSync(path.join(dir, "preferences.json"), '{ "excludeTitleKeywords": ["Mobile"] }');
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

function setup(over: { embedder?: Embedder; openDb?: () => Db } = {}) {
  const logs: string[] = [];
  const errors: string[] = [];
  const tables: Array<Array<Record<string, string | number>>> = [];
  const openDbSpy = vi.fn(over.openDb ?? (() => db));
  const embedder = over.embedder ?? createFakeEmbedder();
  const createEmbedder = vi.fn(async () => embedder);
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
  it("ranks open jobs that pass the hard rules", async () => {
    const { logs, tables, run } = setup();
    expect(await run()).toBe(0);
    expect(logs).toContain("Open jobs: 4, after hard rules: 3 (excluded: title 1, department 0, seniority 0, salary 0)");
    expect(logs).toContain("Embedded 3 new or changed jobs, reused 0");
    expect(tables[0]!.map((r) => r.title)).toEqual(["Senior React Developer", "Senior Node Engineer", "Senior Python Developer"]);
    expect(tables[0]![0]).toMatchObject({ rank: 1, company: "Acme", location: "Remote", url: "https://example.com/acme:a" });
    expect(logs.at(-1)).toBe("Showing 3 of 3");
  });

  it("a second run reuses every embedding", async () => {
    await setup().run();
    const second = setup();
    await second.run();
    expect(second.logs).toContain("Embedded 0 new or changed jobs, reused 3");
  });

  it("--top 1 shows one job", async () => {
    const { logs, tables, run } = setup();
    await run(["--top", "1"]);
    expect(tables[0]).toHaveLength(1);
    expect(logs.at(-1)).toBe("Showing 1 of 3");
  });

  it("a missing search.md fails before opening the DB", async () => {
    fs.rmSync(path.join(dir, "search.md"));
    const { errors, openDbSpy, createEmbedder, run } = setup();
    expect(await run()).toBe(1);
    expect(errors).toEqual(["Missing config/search.md. Copy config/search.example.md to config/search.md and describe the job you want."]);
    expect(openDbSpy).not.toHaveBeenCalled();
    expect(createEmbedder).not.toHaveBeenCalled();
  });

  it("invalid preferences fail before opening the DB", async () => {
    fs.writeFileSync(path.join(dir, "preferences.json"), '{"seniorty":["senior"]}');
    const { errors, openDbSpy, run } = setup();
    expect(await run()).toBe(1);
    expect(errors[0]!.startsWith("config/preferences.json: ")).toBe(true);
    expect(openDbSpy).not.toHaveBeenCalled();
  });

  it("no preferences file applies no rules", async () => {
    fs.rmSync(path.join(dir, "preferences.json"));
    const { logs, run } = setup();
    await run();
    expect(logs).toContain("No config/preferences.json: no hard rules applied");
    expect(logs).toContain("Open jobs: 4, after hard rules: 4 (excluded: title 0, department 0, seniority 0, salary 0)");
  });

  it("no open jobs returns 0 without loading the model", async () => {
    const empty = openDb({ url: ":memory:", migrate: true });
    const { logs, createEmbedder, run } = setup({ openDb: () => empty });
    expect(await run()).toBe(0);
    expect(logs).toEqual(["No open jobs to rank. Run npm run fetch first."]);
    expect(createEmbedder).not.toHaveBeenCalled();
  });

  it("an embedder failure returns 1", async () => {
    const { errors, run } = setup({ embedder: createFakeEmbedder({ fail: () => true }) });
    expect(await run()).toBe(1);
    expect(errors).toEqual(["Embedding failed: Error: model crashed"]);
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
