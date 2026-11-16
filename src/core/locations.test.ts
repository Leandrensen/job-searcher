import { describe, expect, it } from "vitest";
import { countryCodeFromName, deriveRegions, deriveWorkplaceType, type Region } from "./locations";
import type { WorkplaceType } from "./job";

describe("deriveRegions", () => {
  it.each<[string[], Region[]]>([
    [["Remote - LATAM"], ["latam"]],
    [["Remote (Americas)"], ["americas"]],
    [["North America"], ["north-america"]],
    [["Remote - US only"], ["north-america"]],
    [["Remote, United States"], ["north-america"]],
    [["Remote - Brazil"], ["latam-country"]],
    [["Remote - Brazil, Argentina"], ["argentina", "latam-country"]],
    [["Buenos Aires, Argentina"], ["argentina"]],
    [["Remote - Europe"], ["europe"]],
    [["EMEA"], ["emea"]],
    [["Remote - India"], ["apac"]],
    [["Anywhere"], ["worldwide"]],
    [["Remote"], []],
    [["Remote - US", "Remote - LATAM"], ["latam", "north-america"]],
    [["Latinoamérica (remoto)"], ["latam"]],
    [["San Francisco, CA"], []],
    [["Austin, US"], ["north-america"]],
    [["Russia"], []],
    [["Customer success"], []],
    [["South America"], ["south-america"]],
    [["Sudamérica"], ["south-america"]],
    [["Worldwide"], ["worldwide"]],
    [["Remote - UK"], ["europe"]],
    [["Remote - Germany"], ["europe"]],
    [["APAC"], ["apac"]],
    [["Australia"], ["apac"]],
    [["Remote - Canada"], ["north-america"]],
    [["Remote - Mexico"], ["latam-country"]],
    [["Remote - Israel"], ["emea"]],
    [["", "  "], []],
    [[], []],
  ])("%j → %j", (texts, expected) => {
    expect(deriveRegions(texts)).toEqual(expected);
  });

  it("returns unique, alphabetically sorted regions", () => {
    expect(deriveRegions(["Remote - US", "USA", "Brazil", "LATAM", "Europe"])).toEqual([
      "europe",
      "latam",
      "latam-country",
      "north-america",
    ]);
  });
});

describe("countryCodeFromName", () => {
  it.each<[string, string | null]>([
    ["USA", "US"],
    ["United Kingdom", "GB"],
    [" canada ", "CA"],
    ["Argentina", "AR"],
    ["Alemania", "DE"],
    ["New Zealand", "NZ"],
    ["Atlantis", null],
    ["", null],
  ])("%j → %j", (name, expected) => {
    expect(countryCodeFromName(name)).toBe(expected);
  });
});

describe("deriveWorkplaceType", () => {
  it.each<[WorkplaceType | null, string[], WorkplaceType | null]>([
    ["hybrid", ["Remote"], "hybrid"],
    [null, ["Remote - LATAM"], "remote"],
    [null, ["Hybrid - London"], "hybrid"],
    [null, ["On-site, Berlin"], "onsite"],
    [null, ["San Francisco, CA"], "onsite"],
    [null, ["", "  "], null],
    [null, [], null],
    [null, ["Remoto - Argentina"], "remote"],
    [null, ["Anywhere"], "remote"],
    [null, ["Híbrido (Madrid)"], "hybrid"],
    [null, ["Presencial"], "onsite"],
  ])("(%j, %j) → %j", (structured, texts, expected) => {
    expect(deriveWorkplaceType(structured, texts)).toBe(expected);
  });
});
