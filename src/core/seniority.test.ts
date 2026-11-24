import { describe, expect, it } from "vitest";
import { deriveSeniority, type SeniorityLevel } from "./seniority";

describe("deriveSeniority", () => {
  it.each<[string, SeniorityLevel | null]>([
    ["Senior Full-Stack Engineer", "senior"],
    ["Sr. Backend Developer", "senior"],
    ["Staff Software Engineer", "staff"],
    ["Principal Engineer", "principal"],
    ["Tech Lead, Frontend", "lead"],
    ["Senior Engineering Manager", "manager"],
    ["Head of Engineering", "manager"],
    ["Mid-Level React Developer", "mid"],
    ["Junior Node.js Developer", "junior"],
    ["Associate Software Engineer", "junior"],
    ["Software Engineering Intern", "intern"],
    ["Internal Tools Engineer", null],
    ["Software Engineer", null],
    ["", null],
    ["Staff Engineer / Tech Lead", "staff"],
  ])("%j → %j", (title, expected) => {
    expect(deriveSeniority(title)).toBe(expected);
  });
});
