import { z } from "zod";
import { toIsoUtc } from "@/core/dates";
import type { HttpClient } from "@/core/http";
import { salaryPeriodFrom, type WorkplaceType } from "@/core/job";
import { deriveRegions, deriveWorkplaceType } from "@/core/locations";
import { htmlToText, normalizeTags } from "@/core/text";
import type { ProbeResult } from "@/companies/types";
import { defineAdapter, type SourceAdapter } from "../types";
import { displayLocation, NOT_FOUND_PROBE, nullOn404, requireCompanies, uniqueNonEmpty, wrapperSchema } from "./shared";

const offersUrl = (slug: string) => `https://${slug}.recruitee.com/api/offers/`;

const EnvelopeSchema = z.looseObject({ offers: z.array(z.unknown()) });

const ItemSchema = z.object({
  id: z.number(),
  title: z.string(),
  careers_url: z.string(),
  careers_apply_url: z.string().nullish(),
  company_name: z.string().nullish(),
  department: z.string().nullish(),
  location: z.string().nullish(),
  locations: z.array(z.object({ name: z.string().nullish() })).default([]),
  employment_type_code: z.string().nullish(),
  /** "2026-11-16 16:33:49 UTC" */
  published_at: z.string().nullish(),
  created_at: z.string().nullish(),
  description: z.string().nullish(),
  requirements: z.string().nullish(),
  remote: z.boolean().nullish(),
  hybrid: z.boolean().nullish(),
  on_site: z.boolean().nullish(),
  salary: z
    .object({
      min: z.union([z.number(), z.string()]).nullish(),
      max: z.union([z.number(), z.string()]).nullish(),
      period: z.string().nullish(),
      currency: z.string().nullish(),
    })
    .nullish(),
  tags: z.array(z.string()).default([]),
});
const WrappedSchema = wrapperSchema(ItemSchema);
type Raw = z.output<typeof WrappedSchema>;

function amount(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function structuredWorkplace(item: z.output<typeof ItemSchema>): WorkplaceType | null {
  if (item.hybrid === true) return "hybrid";
  if (item.remote === true) return "remote";
  if (item.on_site === true) return "onsite";
  return null;
}

const adapter: SourceAdapter<Raw> = {
  id: "recruitee",
  name: "Recruitee",
  homepage: "https://recruitee.com",
  minIntervalMinutes: 0, // unused: ATS pacing is per company
  techFilter: false, // the ATS runner applies the storage filters
  itemSchema: WrappedSchema,

  async fetch(ctx) {
    const items: unknown[] = [];
    for (const company of requireCompanies(ctx, "recruitee")) {
      const body = EnvelopeSchema.parse(await ctx.http.getJson(offersUrl(company.slug)));
      for (const item of body.offers) items.push({ company, item });
    }
    return items;
  },

  normalize({ company, item }) {
    const texts = [item.location ?? "", ...item.locations.map((l) => l.name ?? "")];
    const descriptionHtml = (item.description ?? "") + (item.requirements ?? "");
    const min = amount(item.salary?.min);
    const max = amount(item.salary?.max);
    const hasSalary = min !== null || max !== null;
    return {
      source: "recruitee",
      externalId: `${company.slug}:${item.id}`,
      url: item.careers_url,
      applyUrl: item.careers_apply_url ?? null,
      title: item.title.trim(),
      company: company.name,
      location: displayLocation(texts),
      workplaceType: deriveWorkplaceType(structuredWorkplace(item), texts),
      departments: uniqueNonEmpty([item.department]),
      regions: deriveRegions(texts),
      employmentType: item.employment_type_code ?? null,
      tags: normalizeTags(item.tags),
      salaryMin: min,
      salaryMax: max,
      salaryCurrency: hasSalary && item.salary?.currency ? item.salary.currency.toUpperCase() : null,
      salaryPeriod: hasSalary ? salaryPeriodFrom(item.salary?.period) : null,
      descriptionHtml,
      descriptionText: htmlToText(descriptionHtml),
      postedAt: toIsoUtc(item.published_at ?? item.created_at),
    };
  },
};

export const recruitee = defineAdapter(adapter);

const ProbeItemSchema = z.object({
  careers_url: z.string(),
  company_name: z.string().nullish(),
  description: z.string().nullish(),
  requirements: z.string().nullish(),
});

export async function probeRecruitee(http: HttpClient, slug: string): Promise<ProbeResult> {
  const body = await nullOn404(() => http.getJson(offersUrl(slug)));
  if (body === null) return NOT_FOUND_PROBE;
  const offers = EnvelopeSchema.parse(body).offers;
  const sample = offers.slice(0, 5).map((o) => ProbeItemSchema.parse(o));
  return {
    exists: true,
    postingCount: offers.length,
    companyName: sample[0]?.company_name ?? null,
    texts: sample.map((o) => htmlToText((o.description ?? "") + (o.requirements ?? ""))),
    urls: sample.map((o) => o.careers_url),
  };
}
