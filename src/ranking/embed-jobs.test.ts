import { beforeEach, describe, expect, it } from "vitest";
import type { Job } from "@/core/job";
import { openDb, type Db } from "@/db/client";
import { upsertJobs } from "@/db/queries";
import { getEmbeddings, listOpenJobsForRanking } from "@/db/ranking";
import { createFakeEmbedder } from "@/test-utils/fake-embedder";
import type { Embedder } from "./embedder";
import { embedJobs } from "./embed-jobs";

const NOW = "2026-11-19T12:00:00.000Z";

function makeJob(n: number, description = `React job ${n}`): Job {
  return {
    source: "greenhouse",
    externalId: `acme:${n}`,
    url: `https://example.com/${n}`,
    applyUrl: null,
    title: `Engineer ${n}`,
    company: "Acme",
    location: null,
    workplaceType: "remote",
    departments: [],
    regions: [],
    employmentType: null,
    tags: [],
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    descriptionHtml: "",
    descriptionText: description,
    postedAt: null,
  };
}

let db: Db;
const seed = (count: number) => upsertJobs(db, Array.from({ length: count }, (_, i) => makeJob(i + 1)), NOW);
const run = (embedder: Embedder, opts: { batchSize?: number } = {}) => embedJobs(db, embedder, listOpenJobsForRanking(db), { nowIso: NOW, ...opts });

beforeEach(() => {
  db = openDb({ url: ":memory:", migrate: true });
});

describe("embedJobs", () => {
  it("embeds every new job and stores it", async () => {
    seed(3);
    const result = await run(createFakeEmbedder());
    expect(result).toMatchObject({ embedded: 3, reused: 0 });
    expect([...result.vectors.keys()]).toEqual([1, 2, 3]);
    expect(getEmbeddings(db, [1, 2, 3]).size).toBe(3);
  });

  it("a second run reuses every vector and calls the embedder 0 times", async () => {
    seed(3);
    await run(createFakeEmbedder());
    const second = createFakeEmbedder();
    expect(await run(second)).toMatchObject({ embedded: 0, reused: 3 });
    expect(second.calls).toEqual([]);
  });

  it("a changed description is embedded again", async () => {
    seed(3);
    await run(createFakeEmbedder());
    upsertJobs(db, [makeJob(2, "Python job two")], NOW);
    expect(await run(createFakeEmbedder())).toMatchObject({ embedded: 1, reused: 2 });
  });

  it("a different model embeds everything again", async () => {
    seed(3);
    await run(createFakeEmbedder());
    expect(await run(createFakeEmbedder({ model: "fake-2" }))).toMatchObject({ embedded: 3, reused: 0 });
  });

  it("embeds in batches", async () => {
    seed(17);
    const embedder = createFakeEmbedder();
    await run(embedder, { batchSize: 16 });
    expect(embedder.calls.map((c) => c.length)).toEqual([16, 1]);
  });

  it("an embedder failure keeps earlier batches", async () => {
    seed(17);
    await expect(run(createFakeEmbedder({ fail: (i) => i === 1 }), { batchSize: 16 })).rejects.toThrow("model crashed");
    expect(getEmbeddings(db, Array.from({ length: 17 }, (_, i) => i + 1)).size).toBe(16);
  });

  it("the wrong number of vectors throws", async () => {
    seed(2);
    const short: Embedder = { model: "m", dimensions: 3, embed: async () => [new Float32Array(3)] };
    await expect(run(short)).rejects.toThrow("embedder returned 1 vectors for 2 texts");
  });

  it("the wrong dimensions throw", async () => {
    seed(2);
    const narrow: Embedder = { model: "m", dimensions: 3, embed: async (texts) => texts.map(() => new Float32Array(2)) };
    await expect(run(narrow)).rejects.toThrow("embedder returned a vector of length 2, expected 3");
  });

  it("no jobs means no work", async () => {
    const embedder = createFakeEmbedder();
    expect(await run(embedder)).toEqual({ vectors: new Map(), embedded: 0, reused: 0 });
    expect(embedder.calls).toEqual([]);
  });
});
