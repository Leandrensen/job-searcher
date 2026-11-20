import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ConfigError } from "./config-error";
import { loadJobFilterRules } from "./job-filter-rules-file";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "m31-"));
});
const write = (name: string, content: string) => fs.writeFileSync(path.join(dir, name), content);
const messageOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return (err as Error).message;
  }
  throw new Error("expected a ConfigError");
};

describe("loadJobFilterRules", () => {
  it("loads the user's file", () => {
    write("job-filter-rules.json", '{ "keywords": ["react"] }');
    expect(loadJobFilterRules(dir)).toEqual({ rules: { keywords: ["react"] }, fromExample: false });
  });

  it("falls back to the example file", () => {
    write("job-filter-rules.example.json", '{ "keywords": ["node"], "seniority": ["senior"] }');
    expect(loadJobFilterRules(dir)).toEqual({ rules: { keywords: ["node"], seniority: ["senior"] }, fromExample: true });
  });

  it("prefers the user's file over the example", () => {
    write("job-filter-rules.json", '{ "keywords": ["react"] }');
    write("job-filter-rules.example.json", '{ "keywords": ["node"] }');
    expect(loadJobFilterRules(dir).rules).toEqual({ keywords: ["react"] });
  });

  it("both missing is a ConfigError", () => {
    expect(messageOf(() => loadJobFilterRules(dir))).toBe("Missing config/job-filter-rules.json and config/job-filter-rules.example.json.");
  });

  it("invalid JSON names the file", () => {
    write("job-filter-rules.json", "{ nope");
    expect(messageOf(() => loadJobFilterRules(dir)).startsWith("config/job-filter-rules.json is not valid JSON: ")).toBe(true);
  });

  it("an invalid example names the example file", () => {
    write("job-filter-rules.example.json", "{ nope");
    expect(messageOf(() => loadJobFilterRules(dir)).startsWith("config/job-filter-rules.example.json is not valid JSON: ")).toBe(true);
  });

  it("an unknown top-level key says (root)", () => {
    write("job-filter-rules.json", '{"keywords":["a"],"keywordz":[]}');
    expect(messageOf(() => loadJobFilterRules(dir)).startsWith("config/job-filter-rules.json: (root): ")).toBe(true);
  });

  it("a nested error names its path", () => {
    write("job-filter-rules.json", '{"keywords":["a"],"seniority":["wizard"]}');
    expect(messageOf(() => loadJobFilterRules(dir)).startsWith("config/job-filter-rules.json: seniority.0: ")).toBe(true);
  });

  it("empty keywords is a ConfigError", () => {
    write("job-filter-rules.json", '{"keywords":[]}');
    expect(messageOf(() => loadJobFilterRules(dir)).startsWith("config/job-filter-rules.json: keywords: ")).toBe(true);
  });
});
