import { z } from "zod";
import { toIsoUtc } from "@/core/dates";
import type { HttpClient } from "@/core/http";
import { deriveRegions, deriveWorkplaceType } from "@/core/locations";
import { htmlToText } from "@/core/text";
import type { ProbeResult } from "@/companies/types";
import type { WorkplaceType } from "@/core/job";
import { defineAdapter, type SourceAdapter } from "../types";
import { displayLocation, NOT_FOUND_PROBE, nullOn404, requireCompanies, uniqueNonEmpty, wrapperSchema } from "./shared";

const postingsUrl = (slug: string) => `https://api.lever.co/v0/postings/${slug}?mode=json`;

const EnvelopeSchema = z.array(z.unknown());

const ItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  hostedUrl: z.string(),
  applyUrl: z.string(),
  categories: z.object({
    location: z.string().nullish(),
    team: z.string().nullish(),
    department: z.string().nullish(),
    commitment: z.string().nullish(),
    allLocations: z.array(z.string()).default([]),
  }),
  workplaceType: z.string().nullish(),
  /** Epoch milliseconds. */
  createdAt: z.number(),
  description: z.string().default(""),
  lists: z.array(z.object({ text: z.string(), content: z.string() })).default([]),
  additional: z.string().default(""),
  salaryRange: z
    .object({ min: z.number(), max: z.number(), currency: z.string(), interval: z.string() })
    .nullish(),
});
const WrappedSchema = wrapperSchema(ItemSchema);
type Raw = z.output<typeof WrappedSchema>;

const ProbeItemSchema = z.object({
  hostedUrl: z.string(),
  descriptionPlain: z.string().nullish(),
});

function structuredWorkplace(value: string | null | undefined): WorkplaceType | null {
  return value === "remote" || value === "hybrid" || value === "onsite" ? value : null;
}

function salaryPeriod(interval: string): "year" | "month" | "hour" | null {
  const i = interval.toLowerCase();
  if (i.includes("year")) return "year";
  if (i.includes("month")) return "month";
  if (i.includes("hour")) return "hour";
  return null;
}

const adapter: SourceAdapter<Raw> = {
  id: "lever",
  name: "Lever",
  homepage: "https://www.lever.co",
  minIntervalMinutes: 0, // unused: ATS pacing is per company
  techFilter: false, // the ATS runner applies the storage filters
  itemSchema: WrappedSchema,

  async fetch(ctx) {
    const items: unknown[] = [];
    for (const company of requireCompanies(ctx, "lever")) {
      const postings = EnvelopeSchema.parse(await ctx.http.getJson(postingsUrl(company.slug)));
      for (const item of postings) items.push({ company, item });
    }
    return items;
  },

  normalize({ company, item }) {
    const texts = [item.categories.location ?? "", ...item.categories.allLocations];
    const descriptionHtml =
      item.description + item.lists.map((l) => `<h3>${l.text}</h3><ul>${l.content}</ul>`).join("") + item.additional;
    const salary = item.salaryRange;
    return {
      source: "lever",
      externalId: `${company.slug}:${item.id}`,
      url: item.hostedUrl,
      applyUrl: item.applyUrl,
      title: item.text.trim(),
      company: company.name,
      location: displayLocation(texts),
      workplaceType: deriveWorkplaceType(structuredWorkplace(item.workplaceType), texts),
      departments: uniqueNonEmpty([item.categories.department, item.categories.team]),
      regions: deriveRegions(texts),
      employmentType: item.categories.commitment ?? null,
      tags: [],
      salaryMin: salary && salary.min > 0 ? salary.min : null,
      salaryMax: salary && salary.max > 0 ? salary.max : null,
      salaryCurrency: salary ? salary.currency.toUpperCase() : null,
      salaryPeriod: salary ? salaryPeriod(salary.interval) : null,
      descriptionHtml,
      descriptionText: htmlToText(descriptionHtml),
      postedAt: toIsoUtc(item.createdAt / 1000), // createdAt is in milliseconds
    };
  },
};

export const lever = defineAdapter(adapter);

export async function probeLever(http: HttpClient, slug: string): Promise<ProbeResult> {
  const body = await nullOn404(() => http.getJson(postingsUrl(slug)));
  if (body === null) return NOT_FOUND_PROBE;
  const postings = EnvelopeSchema.parse(body);
  const sample = postings.slice(0, 5).map((p) => ProbeItemSchema.parse(p));
  // Lever returns no company name, so identity has to come from the postings' text.
  return {
    exists: true,
    postingCount: postings.length,
    companyName: null,
    texts: sample.map((p) => p.descriptionPlain ?? ""),
    urls: sample.map((p) => p.hostedUrl),
  };
}
