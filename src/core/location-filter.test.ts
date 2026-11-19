import { describe, expect, it } from "vitest";
import type { WorkplaceType } from "./job";
import { checkLocation, isAllowedHomeCountry, type LocationVerdict } from "./location-filter";

type Case = [WorkplaceType | null, string[], string | null, LocationVerdict];
const pass: LocationVerdict = { pass: true };
const fail = (reason: "hybrid" | "onsite" | "region" | "company_country"): LocationVerdict => ({ pass: false, reason });

describe("checkLocation", () => {
  it.each<Case>([
    ["remote", ["latam"], "US", pass],
    ["remote", ["americas"], "GB", pass],
    ["remote", ["worldwide"], null, pass],
    ["remote", [], "CA", pass],
    ["remote", ["latam", "north-america"], "AU", pass],
    ["remote", ["argentina", "latam-country"], "NZ", pass],
    [null, [], "DE", pass],
    // A foreign company hiring from Argentina is fine.
    ["remote", ["argentina"], "US", pass],
    ["hybrid", ["latam"], "US", fail("hybrid")],
    ["onsite", [], "US", fail("onsite")],
    ["remote", ["north-america"], "US", fail("region")],
    ["remote", ["latam-country"], "US", fail("region")],
    ["remote", ["europe"], "DE", fail("region")],
    ["remote", ["apac"], "AU", fail("region")],
    ["remote", ["latam"], "AR", fail("company_country")],
    ["remote", ["latam"], "BR", fail("company_country")],
    ["remote", ["latam"], "IN", fail("company_country")],
  ])("%s %j at company in %s → %j", (workplaceType, regions, home, expected) => {
    expect(checkLocation({ workplaceType, regions }, home)).toEqual(expected);
  });

  it("reports the first failing rule", () => {
    expect(checkLocation({ workplaceType: "hybrid", regions: ["europe"] }, "AR")).toEqual(fail("hybrid"));
    expect(checkLocation({ workplaceType: "remote", regions: ["europe"] }, "AR")).toEqual(fail("region"));
  });
});

describe("isAllowedHomeCountry", () => {
  it.each(["US", "CA", "GB", "DE", "CH", "NO", "AU", "NZ", null])("allows %s", (code) => {
    expect(isAllowedHomeCountry(code)).toBe(true);
  });

  it.each(["AR", "BR", "IN", "IL", "SG"])("rejects %s", (code) => {
    expect(isAllowedHomeCountry(code)).toBe(false);
  });
});
