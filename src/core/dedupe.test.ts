import { describe, expect, it } from "vitest";
import { dedupeKey, normalizeCompany, normalizeTitle } from "./dedupe";

describe("dedupe", () => {
  it("normalizeCompany strips suffix and punctuation", () => {
    expect(normalizeCompany("Acme, Inc.")).toBe("acme");
    expect(normalizeCompany("Foo Bar GmbH")).toBe("foobar");
    expect(normalizeCompany("Costa")).toBe("costa");
  });

  it("normalizeTitle keeps seniority words", () => {
    expect(normalizeTitle("Senior  React Dev!")).toBe("senior react dev");
    expect(normalizeTitle("Junior React Dev")).not.toBe(normalizeTitle("Senior React Dev"));
  });

  it("dedupeKey is stable across formatting", () => {
    expect(dedupeKey({ company: "ACME Inc", title: "Senior React Dev!" })).toBe(
      dedupeKey({ company: "acme", title: "senior react dev" }),
    );
  });
});
