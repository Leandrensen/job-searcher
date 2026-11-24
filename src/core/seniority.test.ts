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
    ["Semi Senior Developer", "mid"],
    ["Desarrollador Semi-Senior", "mid"],
    ["Semi Sr. Frontend Engineer", "mid"],
    ["SemiSenior Backend Developer", "mid"],
    ["Junior/Semi-Senior Back-End Engineer (.NET)", "mid"],
    ["Semi Developer", "mid"],
    ["Semiconductor Engineer", null],
    ["Desarrollador SSr Java", "mid"],
    ["Sr/SSr Backend Developer", "senior"],
    ["Senior / Semi Senior Developer", "senior"],
    ["Semi-Senior Lead Developer", "lead"],
    ["Frontend Engineer (Next.js/SSR)", "mid"], // accepted false positive: SSR as server-side rendering
  ])("%j → %j", (title, expected) => {
    expect(deriveSeniority(title)).toBe(expected);
  });
});
