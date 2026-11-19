import { describe, expect, it } from "vitest";
import { dedupeKey, normalizeCompany, normalizeTitle } from "./dedupe";

describe("normalizeCompany", () => {
  it.each([
    ["Acme Corp.", "acme"],
    ["Acme Corp", "acme"],
    ["Acme Corporation", "acme"],
    ["Acme Incorporated", "acme"],
    ["Acme, Inc.", "acme"],
    ["Acme Ltd.", "acme"],
    ["Acme Limited", "acme"],
    ["Acme L.L.C.", "acme"],
    ["Acme GmbH", "acme"],
    ["Acme AG", "acme"],
    ["Acme S.A.", "acme"],
    ["Acme PLC", "acme"],
    ["Acme B.V.", "acme"],
    ["Acme Co., Ltd.", "acme"],
    ["Quantum-Systems GmbH", "quantumsystems"],
    ["Foo Bar GmbH", "foobar"],
    ["Costa", "costa"],
    ["Corpay", "corpay"],
    ["Visa", "visa"],
    ["Inc", "inc"],
    ["Ácme", "ácme"],
    ["Acme Co., Ltd", "acme"],
    ["  ACME   Inc.  ", "acme"],
    ["Acme Inc Inc", "acme"],
    ["Acme GmbH & Co", "acmegmbh"],
    ["", ""],
    ["Inc.", "inc"],
    ["Ltd", "ltd"],
    ["Société Générale SA", "sociétégénérale"],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeCompany(input)).toBe(expected);
  });
});

describe("normalizeTitle", () => {
  it("lowercases and collapses punctuation and spaces", () => {
    expect(normalizeTitle("Senior  React Dev!")).toBe("senior react dev");
  });

  it("keeps seniority words", () => {
    expect(normalizeTitle("Junior React Dev")).not.toBe(normalizeTitle("Senior React Dev"));
  });
});

describe("normalizeTitle edge cases", () => {
  it("handles empty and punctuation-only titles", () => {
    expect(normalizeTitle("")).toBe("");
    expect(normalizeTitle(" -- / ")).toBe("");
  });

  it("keeps non-ASCII letters and digits", () => {
    expect(normalizeTitle("Développeur C++ (Sénior) #2")).toBe("développeur c sénior 2");
  });
});

describe("dedupeKey", () => {
  it("separates different companies with the same title", () => {
    expect(dedupeKey({ company: "Acme", title: "Dev" })).not.toBe(dedupeKey({ company: "Beta", title: "Dev" }));
  });

  it("is stable across formatting", () => {
    expect(dedupeKey({ company: "ACME Inc", title: "Senior React Dev!" })).toBe(
      dedupeKey({ company: "acme", title: "senior react dev" }),
    );
  });

  it('treats "ACME CORP." and "Acme Corp" the same', () => {
    expect(dedupeKey({ company: "ACME CORP.", title: "Dev" })).toBe(dedupeKey({ company: "Acme Corp", title: "Dev" }));
  });

  it("joins company and title with a pipe", () => {
    expect(dedupeKey({ company: "Acme Inc", title: "Senior Dev" })).toBe("acme|senior dev");
  });
});
