import { describe, expect, it } from "vitest";
import { isTechJob, TECH_KEYWORDS } from "./tech-filter";

const job = (title: string, tags: string[] = []) => ({ title, tags });

describe("isTechJob", () => {
  describe("matches tech roles", () => {
    it.each([
      "Senior React Developer",
      "Site Reliability Engineer",
      "Full-Stack Dev",
      "Frontend Engineer",
      "Back End Developer",
      "DevOps Lead",
      "SRE",
      "Data Scientist",
      "Machine Learning Researcher",
      "QA Analyst",
      "iOS Developer",
      "Android Engineer",
      "Cloud Architect",
      "Database Administrator",
      "IT Support Specialist",
      "Technical Support Specialist",
      "CTO",
      "Tech Lead",
      "Senior Software Engineer (Python)",
    ])("%s", (title) => {
      expect(isTechJob(job(title))).toBe(true);
    });

    it("matches via tags only", () => {
      expect(isTechJob(job("Rockstar", ["software development"]))).toBe(true);
      expect(isTechJob(job("Rockstar", ["machine-learning"]))).toBe(true);
    });
  });

  describe("rejects non-tech roles", () => {
    it.each([
      "Account Executive",
      "Email Marketing Manager",
      "Registered Nurse",
      "Recruiter",
      "Customer Success Manager",
      "Paid Social Specialist",
      "Accountant",
      "Content Writer",
      "Revenue Cycle Manager",
      "Senior Medical Director, Product Safety Physician Lead",
      "Studio Manager",
      "Bios Technician",
    ])("%s", (title) => {
      expect(isTechJob(job(title))).toBe(false);
    });

    it("ignores non-tech tags", () => {
      expect(isTechJob(job("Account Executive", ["sales"]))).toBe(false);
    });
  });

  // KNOWN AND ACCEPTED: the filter is a keyword heuristic, so these non-tech jobs pass.
  // M3 (Claude scoring) removes them later. Changing one of these to `false` is a deliberate
  // behavior change: update this table and the PLAN.md decisions log together.
  describe("accepted false positives", () => {
    it.each([
      "Security Guard",
      "AI Trainer",
      "Platform Sales Manager",
      "Sales Engineer",
      "Web Designer",
      "Mobile Sales Representative",
      "Cloud Kitchen Manager",
    ])("%s", (title) => {
      expect(isTechJob(job(title))).toBe(true);
    });
  });

  // KNOWN AND ACCEPTED: tech roles whose titles use none of the keywords are missed.
  describe("known false negatives", () => {
    it.each(["Rust Wizard", "Kubernetes Specialist", "Golang Ninja"])("%s", (title) => {
      expect(isTechJob(job(title))).toBe(false);
    });
  });

  it.each([...TECH_KEYWORDS])("every keyword matches itself: %s", (keyword) => {
    expect(isTechJob(job(keyword))).toBe(true);
  });
});
