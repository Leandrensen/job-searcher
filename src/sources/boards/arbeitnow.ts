import { z } from "zod";
import { toIsoUtc } from "@/core/dates";
import { decodeEntities, htmlToText, normalizeTags } from "@/core/text";
import { defineAdapter, type SourceAdapter } from "../types";

const MAX_PAGES = 3;

const EnvelopeSchema = z.looseObject({
  data: z.array(z.unknown()),
  links: z.looseObject({ next: z.string().nullish() }),
});
const CreatedAtSchema = z.object({ created_at: z.number() });

const ItemSchema = z.object({
  slug: z.string(),
  company_name: z.string(),
  title: z.string(),
  description: z.string(),
  url: z.string(),
  remote: z.boolean(),
  tags: z.array(z.string()).default([]),
  job_types: z.array(z.string()).default([]),
  location: z.string().default(""),
  created_at: z.number(),
});
type Raw = z.output<typeof ItemSchema>;

function reachedKnownJobs(job: unknown, latestPostedAt: string): boolean {
  const parsed = CreatedAtSchema.safeParse(job);
  if (!parsed.success) return false;
  const iso = toIsoUtc(parsed.data.created_at);
  return iso !== null && iso < latestPostedAt;
}

const adapter: SourceAdapter<Raw> = {
  id: "arbeitnow",
  name: "Arbeitnow",
  homepage: "https://www.arbeitnow.com",
  minIntervalMinutes: 60,
  techFilter: true,
  itemSchema: ItemSchema,

  async fetch({ http, latestPostedAt }) {
    const items: unknown[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = EnvelopeSchema.parse(
        await http.getJson(`https://www.arbeitnow.com/api/job-board-api?page=${page}`),
      );
      items.push(...body.data);
      if (!body.links.next) break;
      if (latestPostedAt && body.data.some((j) => reachedKnownJobs(j, latestPostedAt))) break;
    }
    return items;
  },

  normalize(raw) {
    // The source HTML-escapes the description once (&lt;div&gt;).
    const html = decodeEntities(raw.description);
    return {
      source: "arbeitnow",
      externalId: raw.slug,
      url: raw.url,
      applyUrl: null,
      title: raw.title,
      company: raw.company_name,
      location: raw.location || null,
      remote: raw.remote,
      tags: normalizeTags([...raw.tags, ...raw.job_types]),
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      descriptionHtml: html,
      descriptionText: htmlToText(html),
      postedAt: toIsoUtc(raw.created_at),
    };
  },
};

export const arbeitnow = defineAdapter(adapter);
