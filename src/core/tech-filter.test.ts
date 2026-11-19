import { describe, expect, it } from "vitest";
import { isTechJob, TECH_KEYWORDS } from "./tech-filter";

const job = (title: string, departments: string[] = [], tags: string[] = []) => ({ title, departments, tags });

describe("isTechJob", () => {
  describe("matches tech roles", () => {
    it.each([
      "Senior Full-Stack Engineer",
      "Frontend Engineer",
      "Back-End Developer",
      "Software Engineer",
      "Senior Software Developer",
      "Web Developer",
      "UI Engineer",
      "Product Engineer",
      "React Native Developer", // accepted false positive: mobile
      "Node.js Developer",
      "TypeScript Engineer",
      "Next.js Developer",
      "Martech Engineer",
      "Marketing Technology Manager",
      "Snowflake Data Engineer",
      "AWS Cloud Engineer",
    ])("%s", (title) => {
      expect(isTechJob(job(title))).toBe(true);
    });

    it("matches via department or tags", () => {
      expect(isTechJob(job("Rockstar", ["Frontend"]))).toBe(true);
      expect(isTechJob(job("Rockstar", [], ["full stack programming"]))).toBe(true);
    });
  });

  describe("rejects other roles", () => {
    it.each([
      "Account Executive",
      "Sales Engineer",
      "Data Scientist",
      "DevOps Engineer",
      "Site Reliability Engineer",
      "Security Guard",
      "Registered Nurse",
      "Customer Success Manager",
      "Product Manager",
      "Next Generation Sales Lead", // "next" alone is not a keyword
      "Engineer",
    ])("%s", (title) => {
      expect(isTechJob(job(title))).toBe(false);
    });
  });

  it("never reads descriptions", () => {
    expect(isTechJob({ ...job("Account Executive"), descriptionText: "We use React and Node" } as never)).toBe(false);
  });

  // KNOWN AND ACCEPTED: keywords on the title can match non-developer roles. Claude scoring (M4) handles these.
  it("accepts the known false positive 'Segment Marketing Manager'", () => {
    expect(isTechJob(job("Segment Marketing Manager"))).toBe(true);
  });

  it.each([...TECH_KEYWORDS])("every keyword matches itself: %s", (keyword) => {
    expect(isTechJob(job(keyword))).toBe(true);
  });
});
