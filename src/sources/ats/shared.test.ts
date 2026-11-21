import { describe, expect, it } from "vitest";
import { HttpError } from "@/core/http";
import type { FetchContext } from "../types";
import { displayLocation, nullOn404, requireCompanies, uniqueNonEmpty, wrapperSchema } from "./shared";
import { z } from "zod";

const company = { id: 1, ats: "lever" as const, slug: "acme", name: "Acme", homeCountry: null };

describe("uniqueNonEmpty", () => {
  it("trims, drops empty/null/undefined and dedupes in first-seen order", () => {
    expect(uniqueNonEmpty([" b ", "a", null, undefined, "", "   ", "b", "a "])).toEqual(["b", "a"]);
  });
});

describe("displayLocation", () => {
  it("joins unique non-empty parts with ' | '", () => {
    expect(displayLocation(["Berlin", " Berlin ", "", "Remote"])).toBe("Berlin | Remote");
  });
  it("returns null when there is nothing to show", () => {
    expect(displayLocation([])).toBeNull();
    expect(displayLocation(["", "  "])).toBeNull();
  });
});

describe("nullOn404", () => {
  it("returns the value on success", async () => {
    expect(await nullOn404(async () => 42)).toBe(42);
  });
  it("turns an HTTP 404 into null", async () => {
    expect(await nullOn404(async () => { throw new HttpError(404, "https://x", "HTTP 404"); })).toBeNull();
  });
  it("re-throws other HTTP errors and non-HTTP errors", async () => {
    await expect(nullOn404(async () => { throw new HttpError(500, "https://x", "HTTP 500"); })).rejects.toThrow("HTTP 500");
    await expect(nullOn404(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  });
});

describe("requireCompanies", () => {
  const ctx = (companies?: FetchContext["companies"]) => ({ companies }) as FetchContext;
  it("returns the companies of the context", () => {
    expect(requireCompanies(ctx([company]), "lever")).toEqual([company]);
  });
  it("throws when there are none", () => {
    expect(() => requireCompanies(ctx(undefined), "lever")).toThrow("lever: no companies in context");
    expect(() => requireCompanies(ctx([]), "lever")).toThrow("lever: no companies in context");
  });
});

describe("wrapperSchema", () => {
  const schema = wrapperSchema(z.object({ id: z.string() }));
  it("accepts a company with an item", () => {
    expect(schema.safeParse({ company, item: { id: "1" } }).success).toBe(true);
  });
  it("rejects an unknown ATS or a bad item", () => {
    expect(schema.safeParse({ company: { ...company, ats: "nope" }, item: { id: "1" } }).success).toBe(false);
    expect(schema.safeParse({ company, item: { id: 1 } }).success).toBe(false);
  });
});
