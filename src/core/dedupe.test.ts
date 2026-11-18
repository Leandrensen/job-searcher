import { describe, expect, it } from "vitest";
import { dedupeKey, normalizeCompany, normalizeTitle, stripLegalSuffixes, stripLegalSuffixesKeepCase } from "./dedupe";

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
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeCompany(input)).toBe(expected);
  });
});

describe("stripLegalSuffixes", () => {
  it.each([
    ["Acme Labs, Inc.", "acme labs"],
    ["Acme Co., Ltd.", "acme"],
    ["Quantum-Systems GmbH", "quantum-systems"],
    ["Corpay", "corpay"],
    ["Inc", "inc"],
  ])("%j → %j", (input, expected) => {
    expect(stripLegalSuffixes(input)).toBe(expected);
  });
});

describe("stripLegalSuffixesKeepCase", () => {
  it.each([
    ["Acme Labs, Inc.", "Acme Labs"],
    ["Acme Co., Ltd.", "Acme"],
    ["ACME CORP.", "ACME"],
    ["Quantum-Systems GmbH", "Quantum-Systems"],
    ["dbt Labs", "dbt Labs"],
    ["Inc", "Inc"],
    ["  Globex, Inc.  ", "Globex"],
    ["", ""],
  ])("%j → %j", (input, expected) => {
    expect(stripLegalSuffixesKeepCase(input)).toBe(expected);
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

describe("dedupeKey", () => {
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
