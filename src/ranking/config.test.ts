import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ConfigError } from "@/core/config-error";
import { loadSearchDescription } from "./config";

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

describe("the committed example search", () => {
  it("is not empty", () => {
    expect(fs.readFileSync("config/search.example.md", "utf8").trim().length).toBeGreaterThan(0);
  });
});
