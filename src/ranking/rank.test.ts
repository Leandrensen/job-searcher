import { describe, expect, it } from "vitest";
import { createRuleFilter, filterByRules, rankJobs } from "./rank";

const input = (id: number, title: string) => ({
  id,
  title,
  departments: [],
  tags: [],
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  salaryPeriod: null,
});

describe("rankJobs", () => {
  const search = new Float32Array([1, 0]);
  const vectors = new Map([
    [1, new Float32Array([1, 0])],
    [2, new Float32Array([0.6, 0.8])],
    [3, new Float32Array([0, 1])],
  ]);

  it("ranks by similarity, highest first", () => {
    const ranked = rankJobs([{ id: 3 }, { id: 1 }, { id: 2 }], vectors, search, 10);
    expect(ranked.map((r) => r.job.id)).toEqual([1, 2, 3]);
    expect(ranked[0]!.similarity).toBeCloseTo(1, 6);
    expect(ranked[1]!.similarity).toBeCloseTo(0.6, 6);
    expect(ranked[2]!.similarity).toBeCloseTo(0, 6);
  });

  it("breaks ties by id", () => {
    const tied = new Map([
      [7, new Float32Array([1, 0])],
      [5, new Float32Array([1, 0])],
    ]);
    expect(rankJobs([{ id: 7 }, { id: 5 }], tied, search, 10).map((r) => r.job.id)).toEqual([5, 7]);
  });

  it("takes the top N", () => {
    expect(rankJobs([{ id: 1 }, { id: 2 }, { id: 3 }], vectors, search, 2)).toHaveLength(2);
  });

  it("skips jobs without a vector", () => {
    expect(rankJobs([{ id: 1 }, { id: 99 }], vectors, search, 10).map((r) => r.job.id)).toEqual([1]);
  });

  it("no jobs gives no results", () => {
    expect(rankJobs([], vectors, search, 10)).toEqual([]);
  });
});

describe("filterByRules", () => {
  it("keeps the passing jobs in order and counts the rest", () => {
    const { passing, skipped } = filterByRules(
      [input(1, "React Developer"), input(2, "Account Executive"), input(3, "Node Engineer")],
      { keywords: ["react", "node"] },
    );
    expect(passing.map((j) => j.id)).toEqual([1, 3]);
    expect(skipped).toBe(1);
  });

  it("no jobs", () => {
    expect(filterByRules([], { keywords: ["react"] })).toEqual({ passing: [], skipped: 0 });
  });

  it("a job with no salary passes a salary floor", () => {
    expect(filterByRules([input(1, "React Developer")], { keywords: ["react"], salaryFloor: { USD: 60000 } }).skipped).toBe(0);
  });
});

describe("createRuleFilter", () => {
  it("keeps passing jobs and counts the rest", () => {
    const filter = createRuleFilter({ keywords: ["react", "node"] });
    expect([input(1, "React Developer"), input(2, "Account Executive"), input(3, "Node Engineer")].map(filter.keep)).toEqual([true, false, true]);
    expect(filter.skipped()).toBe(1);
  });

  it("starts at zero", () => {
    expect(createRuleFilter({ keywords: ["react"] }).skipped()).toBe(0);
  });

  it("a job with no salary passes a salary floor", () => {
    expect(createRuleFilter({ keywords: ["react"], salaryFloor: { USD: 60000 } }).keep(input(1, "React Developer"))).toBe(true);
  });
});
