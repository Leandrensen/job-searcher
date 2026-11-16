import { z } from "zod";
import { toIsoUtc } from "@/core/dates";
import type { HttpClient } from "@/core/http";
import type { WorkplaceType } from "@/core/job";
import { deriveRegions, deriveWorkplaceType } from "@/core/locations";
import { htmlToText } from "@/core/text";
import type { ProbeResult } from "@/companies/types";
import { defineAdapter, type SourceAdapter } from "../types";
import { displayLocation, NOT_FOUND_PROBE, nullOn404, requireCompanies, uniqueNonEmpty, wrapperSchema } from "./shared";

const boardUrl = (slug: string) => `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`;

const EnvelopeSchema = z.looseObject({ jobs: z.array(z.unknown()) });

const CompensationSchema = z.looseObject({
  compensationTiers: z
    .array(
      z.looseObject({
        components: z
          .array(
            z.looseObject({
              compensationType: z.string(),
              interval: z.string().nullish(),
              currencyCode: z.string().nullish(),
              minValue: z.number().nullish(),
              maxValue: z.number().nullish(),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

const ItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  jobUrl: z.string(),
  applyUrl: z.string(),
  department: z.string().nullish(),
  team: z.string().nullish(),
  employmentType: z.string().nullish(),
  location: z.string().nullish(),
  secondaryLocations: z.array(z.object({ location: z.string().nullish() })).default([]),
  workplaceType: z.string().nullish(),
  isRemote: z.boolean().nullish(),
  isListed: z.boolean().default(true),
  publishedAt: z.string().nullish(),
  descriptionHtml: z.string().nullish(),
  // A malformed compensation block must not invalidate the whole job.
  compensation: CompensationSchema.nullish().catch(null),
});
const WrappedSchema = wrapperSchema(ItemSchema);
type Raw = z.output<typeof WrappedSchema>;

const ProbeItemSchema = z.object({ jobUrl: z.string(), descriptionPlain: z.string().nullish() });

function structuredWorkplace(item: z.output<typeof ItemSchema>): WorkplaceType | null {
  switch (item.workplaceType?.toLowerCase().replace(/-/g, "")) {
    case "remote":
      return "remote";
    case "hybrid":
      return "hybrid";
    case "onsite":
      return "onsite";
    default:
      return item.isRemote === true ? "remote" : null;
  }
}

function salaryOf(item: z.output<typeof ItemSchema>) {
  const component = item.compensation?.compensationTiers
    .flatMap((t) => t.components)
    .find((c) => c.compensationType === "Salary");
  if (!component) return { min: null, max: null, currency: null, period: null } as const;
  const interval = (component.interval ?? "").toUpperCase();
  const period = interval.includes("YEAR") ? "year" : interval.includes("MONTH") ? "month" : interval.includes("HOUR") ? "hour" : null;
  return {
    min: component.minValue && component.minValue > 0 ? component.minValue : null,
    max: component.maxValue && component.maxValue > 0 ? component.maxValue : null,
    currency: component.currencyCode ? component.currencyCode.toUpperCase() : null,
    period,
  } as const;
}

const adapter: SourceAdapter<Raw> = {
  id: "ashby",
  name: "Ashby",
  homepage: "https://www.ashbyhq.com",
  minIntervalMinutes: 0, // unused: ATS pacing is per company
  techFilter: false, // the ATS runner applies the storage filters
  itemSchema: WrappedSchema,

  async fetch(ctx) {
    const items: unknown[] = [];
    for (const company of requireCompanies(ctx, "ashby")) {
      const body = EnvelopeSchema.parse(await ctx.http.getJson(boardUrl(company.slug)));
      for (const item of body.jobs) {
        if (typeof item === "object" && item !== null && (item as { isListed?: unknown }).isListed === false) continue;
        items.push({ company, item });
      }
    }
    return items;
  },

  normalize({ company, item }) {
    const texts = [item.location ?? "", ...item.secondaryLocations.map((l) => l.location ?? "")];
    const salary = salaryOf(item);
    const descriptionHtml = item.descriptionHtml ?? "";
    return {
      source: "ashby",
      externalId: `${company.slug}:${item.id}`,
      url: item.jobUrl,
      applyUrl: item.applyUrl,
      title: item.title.trim(),
      company: company.name,
      location: displayLocation(texts),
      workplaceType: deriveWorkplaceType(structuredWorkplace(item), texts),
      departments: uniqueNonEmpty([item.department, item.team]),
      regions: deriveRegions(texts),
      employmentType: item.employmentType ?? null,
      tags: [],
      salaryMin: salary.min,
      salaryMax: salary.max,
      salaryCurrency: salary.currency,
      salaryPeriod: salary.period,
      descriptionHtml,
      descriptionText: htmlToText(descriptionHtml),
      postedAt: toIsoUtc(item.publishedAt),
    };
  },
};

export const ashby = defineAdapter(adapter);

export async function probeAshby(http: HttpClient, slug: string): Promise<ProbeResult> {
  const body = await nullOn404(() => http.getJson(boardUrl(slug)));
  if (body === null) return NOT_FOUND_PROBE;
  const jobs = EnvelopeSchema.parse(body).jobs;
  const sample = jobs.slice(0, 5).map((j) => ProbeItemSchema.parse(j));
  // Ashby returns no company name, so identity has to come from the postings' text.
  return {
    exists: true,
    postingCount: jobs.length,
    companyName: null,
    texts: sample.map((j) => j.descriptionPlain ?? ""),
    urls: sample.map((j) => j.jobUrl),
  };
}
