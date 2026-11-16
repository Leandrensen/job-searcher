import { z } from "zod";
import { toIsoUtc } from "@/core/dates";
import type { HttpClient } from "@/core/http";
import { deriveRegions, deriveWorkplaceType } from "@/core/locations";
import { htmlToText } from "@/core/text";
import type { ProbeResult } from "@/companies/types";
import { defineAdapter, type SourceAdapter } from "../types";
import { displayLocation, NOT_FOUND_PROBE, nullOn404, requireCompanies, uniqueNonEmpty, wrapperSchema } from "./shared";

const accountUrl = (slug: string) => `https://apply.workable.com/api/v1/widget/accounts/${slug}`;

const EnvelopeSchema = z.looseObject({ name: z.string(), jobs: z.array(z.unknown()) });

const LocationSchema = z.object({
  city: z.string().nullish(),
  region: z.string().nullish(),
  country: z.string().nullish(),
});

const ItemSchema = z.object({
  shortcode: z.string(),
  title: z.string(),
  url: z.string(),
  application_url: z.string().nullish(),
  published_on: z.string().nullish(),
  created_at: z.string().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  country: z.string().nullish(),
  department: z.string().nullish(),
  employment_type: z.string().nullish(),
  description: z.string().nullish(),
  telecommuting: z.boolean().nullish(),
  locations: z.array(LocationSchema).default([]),
  /** Added by fetch(): the other rows' locations for the same shortcode. */
  extra_locations: z.array(z.string()).default([]),
});
const WrappedSchema = wrapperSchema(ItemSchema);
type Raw = z.output<typeof WrappedSchema>;

const place = (parts: Array<string | null | undefined>) => uniqueNonEmpty(parts).join(", ");

const RowSchema = z.looseObject({ shortcode: z.string() });

/**
 * Workable lists a job once per city (same shortcode). Merge those rows into one item that keeps every
 * location, so the job gets a single stable id and all of its regions.
 */
function mergeRows(rows: unknown[]): unknown[] {
  const merged = new Map<string, Record<string, unknown>>();
  const out: unknown[] = [];
  for (const row of rows) {
    const key = RowSchema.safeParse(row);
    if (!key.success) {
      out.push(row);
      continue;
    }
    const own = LocationSchema.safeParse(row);
    const ownText = own.success ? place([own.data.city, (row as { state?: string }).state, own.data.country]) : "";
    const first = merged.get(key.data.shortcode);
    if (!first) {
      const copy = { ...(row as Record<string, unknown>), extra_locations: [] as string[] };
      merged.set(key.data.shortcode, copy);
      out.push(copy);
    } else if (ownText) {
      (first.extra_locations as string[]).push(ownText);
    }
  }
  return out;
}

const adapter: SourceAdapter<Raw> = {
  id: "workable",
  name: "Workable",
  homepage: "https://www.workable.com",
  minIntervalMinutes: 0, // unused: ATS pacing is per company
  techFilter: false, // the ATS runner applies the storage filters
  itemSchema: WrappedSchema,

  async fetch(ctx) {
    const items: unknown[] = [];
    for (const company of requireCompanies(ctx, "workable")) {
      const body = EnvelopeSchema.parse(await ctx.http.getJson(`${accountUrl(company.slug)}?details=true`));
      for (const item of mergeRows(body.jobs)) items.push({ company, item });
    }
    return items;
  },

  normalize({ company, item }) {
    const texts = uniqueNonEmpty([
      place([item.city, item.state, item.country]),
      ...item.locations.map((l) => place([l.city, l.region, l.country])),
      ...item.extra_locations,
    ]);
    const descriptionHtml = item.description ?? "";
    return {
      source: "workable",
      externalId: `${company.slug}:${item.shortcode}`,
      url: item.url,
      applyUrl: item.application_url ?? null,
      title: item.title.trim(),
      company: company.name,
      location: displayLocation(texts),
      workplaceType: deriveWorkplaceType(item.telecommuting === true ? "remote" : null, texts),
      departments: uniqueNonEmpty([item.department]),
      regions: deriveRegions(texts),
      employmentType: item.employment_type ?? null,
      tags: [],
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      descriptionHtml,
      descriptionText: htmlToText(descriptionHtml),
      postedAt: toIsoUtc(item.published_on ?? item.created_at),
    };
  },
};

export const workable = defineAdapter(adapter);

export async function probeWorkable(http: HttpClient, slug: string): Promise<ProbeResult> {
  const body = await nullOn404(() => http.getJson(accountUrl(slug)));
  if (body === null) return NOT_FOUND_PROBE;
  const { name, jobs } = EnvelopeSchema.parse(body);
  const urls = jobs
    .slice(0, 5)
    .map((j) => z.looseObject({ url: z.string().nullish() }).parse(j).url)
    .filter((u): u is string => !!u);
  // Without ?details=true there are no descriptions, so identity here comes from the account name.
  return { exists: true, postingCount: jobs.length, companyName: name, texts: [], urls };
}
