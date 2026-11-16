import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SOURCE_IDS } from "@/core/job";
import { adapters } from "./registry";

const ids = adapters.map((a) => a.id);

describe("source registry", () => {
  it("adapter ids are unique", () => {
    expect(new Set(ids).size).toBe(ids.length);
  });

  // TODO(M2 T16): restore the exact check ([...ids].sort() equals [...SOURCE_IDS].sort()) once all 6 ATS adapters exist.
  it("only registers known source ids", () => {
    for (const id of ids) expect(SOURCE_IDS).toContain(id);
  });

  it("keeps the documented run order", () => {
    expect(ids).toEqual([
      "remoteok",
      "weworkremotely",
      "remotive",
      "himalayas",
      "jobicy",
      "workingnomads",
      "arbeitnow",
    ]);
  });

  it.each(ids)("adapter %s has a file with the same name", (id) => {
    expect(fs.existsSync(path.resolve(__dirname, "boards", `${id}.ts`))).toBe(true);
  });

  it.each(adapters.map((a) => [a.id, a] as const))("adapter %s declares sane metadata", (_id, adapter) => {
    expect(adapter.name.trim()).not.toBe("");
    expect(adapter.homepage).toMatch(/^https:\/\//);
    expect(adapter.minIntervalMinutes).toBeGreaterThanOrEqual(60);
    expect(typeof adapter.techFilter).toBe("boolean");
  });

  it("keeps the 6 hour minimum interval for the rate-limited source", () => {
    const interval = (id: string) => adapters.find((a) => a.id === id)?.minIntervalMinutes;
    expect(interval("remotive")).toBe(360);
  });
});
