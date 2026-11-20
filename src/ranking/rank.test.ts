import { describe, expect, it } from "vitest";
import { rankJobs } from "./rank";

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
