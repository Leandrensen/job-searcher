import { z } from "zod";
import { toIsoUtc } from "@/core/dates";
import type { HttpClient } from "@/core/http";
import { deriveRegions, deriveWorkplaceType } from "@/core/locations";
import { decodeEntities, htmlToText } from "@/core/text";
import type { ProbeResult } from "@/companies/types";
import { defineAdapter, type SourceAdapter } from "../types";
import { displayLocation, NOT_FOUND_PROBE, nullOn404, requireCompanies, uniqueNonEmpty, wrapperSchema } from "./shared";

const boardUrl = (slug: string) => `https://boards-api.greenhouse.io/v1/boards/${slug}`;
const jobsUrl = (slug: string) => `${boardUrl(slug)}/jobs?content=true`;

const EnvelopeSchema = z.looseObject({ jobs: z.array(z.unknown()) });
const BoardSchema = z.looseObject({ name: z.string() });

const ItemSchema = z.object({
  id: z.number(),
  title: z.string(),
  absolute_url: z.string(),
  location: z.object({ name: z.string() }).nullish(),
  departments: z.array(z.object({ name: z.string() })).default([]),
  content: z.string().default(""),
  first_published: z.string().nullish(),
  updated_at: z.string().nullish(),
});
const WrappedSchema = wrapperSchema(ItemSchema);
type Raw = z.output<typeof WrappedSchema>;

const adapter: SourceAdapter<Raw> = {
  id: "greenhouse",
  name: "Greenhouse",
  homepage: "https://www.greenhouse.com",
  minIntervalMinutes: 0, // unused: ATS pacing is per company
  techFilter: false, // the ATS runner applies the storage filters
  itemSchema: WrappedSchema,

  async fetch(ctx) {
    const items: unknown[] = [];
    for (const company of requireCompanies(ctx, "greenhouse")) {
      const body = EnvelopeSchema.parse(await ctx.http.getJson(jobsUrl(company.slug)));
      for (const item of body.jobs) items.push({ company, item });
    }
    return items;
  },

  normalize({ company, item }) {
    const texts = [item.location?.name ?? ""];
    // Greenhouse HTML-escapes the content once.
    const descriptionHtml = decodeEntities(item.content);
    return {
      source: "greenhouse",
      externalId: `${company.slug}:${item.id}`,
      url: item.absolute_url,
      applyUrl: null,
      title: item.title.trim(),
      company: company.name,
      location: displayLocation(texts),
      workplaceType: deriveWorkplaceType(null, texts),
      departments: uniqueNonEmpty(item.departments.map((d) => d.name)),
      regions: deriveRegions(texts),
      employmentType: null,
      tags: [],
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      descriptionHtml,
      descriptionText: htmlToText(descriptionHtml),
      // first_published, never updated_at (which changes on edits)
      postedAt: toIsoUtc(item.first_published),
    };
  },
};

export const greenhouse = defineAdapter(adapter);

export async function probeGreenhouse(http: HttpClient, slug: string): Promise<ProbeResult> {
  const board = await nullOn404(() => http.getJson(boardUrl(slug)));
  if (board === null) return NOT_FOUND_PROBE;
  const { name } = BoardSchema.parse(board);
  const jobs = await nullOn404(() => http.getJson(jobsUrl(slug)));
  const items = jobs === null ? [] : EnvelopeSchema.parse(jobs).jobs;
  const sample = items.slice(0, 5).map((i) => ItemSchema.parse(i));
  return {
    exists: true,
    postingCount: items.length,
    companyName: name,
    texts: sample.map((i) => htmlToText(decodeEntities(i.content))),
    urls: sample.map((i) => i.absolute_url),
  };
}
