import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ConfigError } from "@/core/config-error";
import { loadPreferences, loadSearchDescription, PreferencesSchema } from "./config";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "m3-"));
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

describe("loadSearchDescription", () => {
  it("loads and trims the search description", () => {
    write("search.md", "  Senior React role\n\n");
    expect(loadSearchDescription(dir)).toBe("Senior React role");
  });

  it("a missing search.md is a ConfigError with instructions", () => {
    expect(messageOf(() => loadSearchDescription(dir))).toBe(
      "Missing config/search.md. Copy config/search.example.md to config/search.md and describe the job you want.",
    );
  });

  it("an empty search.md is a ConfigError", () => {
    write("search.md", " \n\n ");
    expect(messageOf(() => loadSearchDescription(dir))).toBe("config/search.md is empty.");
  });
});

describe("loadPreferences", () => {
  it("a missing preferences.json means no rules", () => {
    expect(loadPreferences(dir)).toEqual({ prefs: {}, found: false });
  });

  it("loads valid preferences", () => {
    const example = fs.readFileSync("config/preferences.example.json", "utf8");
    write("preferences.json", example);
    expect(loadPreferences(dir)).toEqual({ prefs: JSON.parse(example), found: true });
  });

  it("invalid JSON is a ConfigError", () => {
    write("preferences.json", "{ nope");
    expect(messageOf(() => loadPreferences(dir)).startsWith("config/preferences.json is not valid JSON: ")).toBe(true);
  });

  it("an unknown seniority level is a ConfigError", () => {
    write("preferences.json", '{"seniority":["wizard"]}');
    expect(messageOf(() => loadPreferences(dir)).startsWith("config/preferences.json: seniority.0: ")).toBe(true);
  });

  it("an unknown key is a ConfigError", () => {
    write("preferences.json", '{"seniorty":["senior"]}');
    expect(messageOf(() => loadPreferences(dir)).startsWith("config/preferences.json: ")).toBe(true);
  });

  it("a lowercase currency is a ConfigError", () => {
    write("preferences.json", '{"salaryFloor":{"usd":1}}');
    expect(messageOf(() => loadPreferences(dir)).startsWith("config/preferences.json: ")).toBe(true);
  });
});

describe("the committed example files", () => {
  it("are valid", () => {
    const prefs = JSON.parse(fs.readFileSync("config/preferences.example.json", "utf8"));
    expect(PreferencesSchema.safeParse(prefs).success).toBe(true);
    expect(fs.readFileSync("config/search.example.md", "utf8").trim().length).toBeGreaterThan(0);
  });
});
