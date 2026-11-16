import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SOURCE_IDS } from "@/core/job";
import { adapters, atsAdapters, boardAdapters } from "./registry";

const ids = adapters.map((a) => a.id);
const boardIds = boardAdapters.map((a) => a.id);
const atsIds = atsAdapters.map((a) => a.id);

describe("source registry", () => {
  it("adapter ids are unique", () => {
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers SOURCE_IDS exactly", () => {
    expect([...ids].sort()).toEqual([...SOURCE_IDS].sort());
  });

  it("keeps the documented run order: boards first, then ATSs", () => {
    expect(ids).toEqual([...boardIds, ...atsIds]);
    expect(boardIds).toEqual([
      "remoteok",
      "weworkremotely",
      "remotive",
      "himalayas",
      "jobicy",
      "workingnomads",
      "arbeitnow",
    ]);
    // Each task of M2 Part D appends one ATS here.
    expect(atsIds).toEqual(["greenhouse", "lever", "ashby", "workable", "recruitee", "smartrecruiters"]);
  });

  it.each(ids)("adapter %s has a file with the same name", (id) => {
    expect(fs.existsSync(path.resolve(__dirname, boardIds.includes(id) ? "boards" : "ats", `${id}.ts`))).toBe(true);
  });

  it.each(adapters.map((a) => [a.id, a] as const))("adapter %s declares sane metadata", (_id, adapter) => {
    expect(adapter.name.trim()).not.toBe("");
    expect(adapter.homepage).toMatch(/^https:\/\//);
    // Boards are polled at most hourly. ATS pacing is per company, so their interval is unused.
    if (boardIds.includes(adapter.id)) expect(adapter.minIntervalMinutes).toBeGreaterThanOrEqual(60);
    else expect(adapter.minIntervalMinutes).toBe(0);
    expect(typeof adapter.techFilter).toBe("boolean");
  });

  it("keeps the 6 hour minimum interval for the rate-limited source", () => {
    const interval = (id: string) => adapters.find((a) => a.id === id)?.minIntervalMinutes;
    expect(interval("remotive")).toBe(360);
  });
});
