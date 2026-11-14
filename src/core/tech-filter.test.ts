import { describe, expect, it } from "vitest";
import { isTechJob } from "./tech-filter";

describe("isTechJob", () => {
  it("matches developer titles", () => {
    expect(isTechJob({ title: "Senior React Developer", tags: [] })).toBe(true);
    expect(isTechJob({ title: "Site Reliability Engineer", tags: [] })).toBe(true);
    expect(isTechJob({ title: "Full-Stack Dev", tags: [] })).toBe(true);
  });

  it("matches via tags only", () => {
    expect(isTechJob({ title: "Rockstar", tags: ["software development"] })).toBe(true);
    expect(isTechJob({ title: "Rockstar", tags: ["machine-learning"] })).toBe(true);
  });

  it("rejects sales roles", () => {
    expect(isTechJob({ title: "Account Executive", tags: ["sales"] })).toBe(false);
  });

  it("does not match ai inside email", () => {
    expect(isTechJob({ title: "Email Marketing Manager", tags: [] })).toBe(false);
  });
});
