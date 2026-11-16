import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "@/core/http";
import { expectCleanText } from "@/test-utils/assertions";
import { loadFixture } from "@/test-utils/fixtures";
import { runAdapter } from "../run-adapter";
import type { FetchContext } from "../types";
import { getonboard } from "./getonboard";

const fixture = loadFixture("getonboard/programming.json") as { data: unknown[]; meta: unknown };

function ctxWith(totalPages: number) {
  const getJson = vi.fn(async (url: string) => {
    const page = Number(new URL(url).searchParams.get("page"));
    return { data: fixture.data, meta: { page, per_page: 100, total_pages: totalPages } };
  });
  const http: HttpClient = { getJson, getText: vi.fn() };
  const ctx: FetchContext = { http, latestPostedAt: null, log: () => {} };
  return { ctx, getJson };
}

describe("getonboard adapter", () => {
  it("stops paging at total_pages", async () => {
    const { ctx, getJson } = ctxWith(2);
    const items = await getonboard.fetch(ctx);
    expect(getJson).toHaveBeenCalledTimes(12); // 6 categories x 2 pages
    expect(items).toHaveLength(12 * 4);
    const urls = getJson.mock.calls.map((c) => c[0]);
    expect(urls[0]).toBe(
      "https://www.getonbrd.com/api/v0/categories/programming/jobs?per_page=100&page=1&expand=%5B%22company%22%5D",
    );
    expect(urls[1]).toContain("/categories/programming/jobs?per_page=100&page=2");
  });

  it("caps at 3 pages per category", async () => {
    const { ctx, getJson } = ctxWith(10);
    await getonboard.fetch(ctx);
    expect(getJson).toHaveBeenCalledTimes(18);
  });

  it("throws when the envelope has the wrong shape", async () => {
    const http: HttpClient = { getJson: vi.fn(async () => ({ nope: 1 })), getText: vi.fn() };
    await expect(getonboard.fetch({ http, latestPostedAt: null, log: () => {} })).rejects.toThrow();
  });

  it("normalizes a typical item", () => {
    const raw = getonboard.itemSchema.parse(fixture.data[0]);
    const { descriptionHtml, descriptionText, ...rest } = getonboard.normalize(raw)!;
    expect(rest).toEqual({
      source: "getonboard",
      externalId: "semi-senior-full-stack-java-developer-qa-ai-bilingue-23people-santiago",
      url: "https://www.getonbrd.com/jobs/semi-senior-full-stack-java-developer-qa-ai-bilingue-23people-santiago",
      applyUrl: null,
      title: "Semi Senior Full-Stack Java Developer (QA & AI) Bilingüe",
      company: "23people",
      location: "Chile",
      remote: false,
      tags: ["programming"],
      salaryMin: 2800,
      salaryMax: 3000,
      salaryCurrency: "USD",
      salaryPeriod: "month",
      postedAt: "2026-11-09T12:28:17.000Z",
    });
    expect(descriptionHtml).toContain("<ul><li>Experiencia comprobable con Java y Spring Boot");
    expectCleanText(descriptionText, "- Experiencia comprobable con Java y Spring Boot en proyectos reales.");
  });

  it("maps remote modalities", () => {
    const remotes = fixture.data.map((d) => getonboard.normalize(getonboard.itemSchema.parse(d))?.remote);
    expect(remotes).toEqual([false, true, false, true]); // hybrid, fully_remote, no_remote, remote_local
  });

  it("sets salary null when absent", () => {
    const job = getonboard.normalize(getonboard.itemSchema.parse(fixture.data[3]));
    expect(job).toMatchObject({ salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null });
  });

  it("uses Unknown when company not expanded", () => {
    const raw = getonboard.itemSchema.parse({
      id: "x",
      links: { public_url: "https://www.getonbrd.com/jobs/x" },
      attributes: {
        title: "Dev",
        remote_modality: null,
        published_at: 1794227297,
        category_name: null,
        company: { data: { id: "4457", type: "company" } },
      },
    });
    const job = getonboard.normalize(raw);
    expect(job).toMatchObject({ company: "Unknown", remote: null, location: null, tags: [] });
  });

  it("dedupes jobs repeated across categories via runAdapter", async () => {
    const { ctx } = ctxWith(1);
    const r = await runAdapter(getonboard, ctx);
    expect(r).toMatchObject({ status: "success", fetched: 24, invalid: 0 });
    expect(r.jobs).toHaveLength(4);
  });
});
