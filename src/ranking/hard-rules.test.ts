import { describe, expect, it } from "vitest";
import type { Preferences } from "./config";
import { checkHardRules, type Exclusion, type RuleInput } from "./hard-rules";

const base: RuleInput = {
  title: "Senior React Developer",
  departments: ["Engineering"],
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  salaryPeriod: null,
};
const PASS = { pass: true } as const;
const fail = (reason: Exclusion) => ({ pass: false, reason }) as const;

describe("checkHardRules", () => {
  it.each<[string, Partial<RuleInput>, Preferences, ReturnType<typeof checkHardRules>]>([
    ["no rules", {}, {}, PASS],
    ["an excluded title keyword", {}, { excludeTitleKeywords: ["React"] }, fail("title")],
    ["a title keyword that isn't in the title", {}, { excludeTitleKeywords: ["Mobile"] }, PASS],
    ["a keyword inside another word doesn't match", { title: "Reactive Engineer" }, { excludeTitleKeywords: ["React"] }, PASS],
    ["an excluded department, case-insensitive", {}, { excludeDepartments: ["engineering"] }, fail("department")],
    ["a seniority outside the list", {}, { seniority: ["mid"] }, fail("seniority")],
    ["a seniority in the list", {}, { seniority: ["senior"] }, PASS],
    ["an unknown seniority passes", { title: "React Developer" }, { seniority: ["mid"] }, PASS],
    ["a yearly salary below the floor", { salaryMax: 50000, salaryCurrency: "USD", salaryPeriod: "year" }, { salaryFloor: { USD: 60000 } }, fail("salary")],
    ["a range reaching the floor", { salaryMin: 50000, salaryMax: 70000, salaryCurrency: "USD", salaryPeriod: "year" }, { salaryFloor: { USD: 60000 } }, PASS],
    ["a monthly salary is annualized (72,000)", { salaryMax: 6000, salaryCurrency: "USD", salaryPeriod: "month" }, { salaryFloor: { USD: 60000 } }, PASS],
    ["an hourly salary is annualized (52,000)", { salaryMax: 25, salaryCurrency: "USD", salaryPeriod: "hour" }, { salaryFloor: { USD: 60000 } }, fail("salary")],
    ["a currency without a floor passes", { salaryMax: 100, salaryCurrency: "EUR", salaryPeriod: "year" }, { salaryFloor: { USD: 60000 } }, PASS],
    ["no salary passes", { salaryCurrency: "USD" }, { salaryFloor: { USD: 60000 } }, PASS],
    ["a salary with no period counts as yearly", { salaryMax: 59999, salaryCurrency: "USD", salaryPeriod: null }, { salaryFloor: { USD: 60000 } }, fail("salary")],
    ["the first failing rule is reported", { salaryMax: 1, salaryCurrency: "USD", salaryPeriod: "year" }, { excludeTitleKeywords: ["React"], salaryFloor: { USD: 60000 } }, fail("title")],
  ])("%s", (_label, over, prefs, expected) => {
    expect(checkHardRules({ ...base, ...over }, prefs)).toEqual(expected);
  });
});
