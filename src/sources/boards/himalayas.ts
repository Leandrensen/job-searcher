import { z } from "zod";
import { toIsoUtc } from "@/core/dates";
import { htmlToText, normalizeTags } from "@/core/text";
import { salaryPeriodFrom } from "@/core/job";
import { defineAdapter, type AnyAdapter, type SourceAdapter } from "../types";

const BASE_URL = "https://himalayas.app/jobs/api?limit=20";
const MAX_PAGES = 50;
const PAGE_DELAY_MS = 500;

const EnvelopeSchema = z.looseObject({
  jobs: z.array(z.unknown()),
  nextCursor: z.string().nullish(),
});
const PubDateSchema = z.object({ pubDate: z.number() });

const ItemSchema = z.object({
  guid: z.string(),
  title: z.string(),
  companyName: z.string(),
  description: z.string(),
  applicationLink: z.string(),
  pubDate: z.number(),
  minSalary: z.number().nullish(),
  maxSalary: z.number().nullish(),
  currency: z.string().nullish(),
  salaryPeriod: z.string().nullish(),
  locationRestrictions: z.array(z.string()).default([]),
  categories: z.array(z.string()).default([]),
  seniority: z.array(z.string()).default([]),
});
type Raw = z.output<typeof ItemSchema>;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createHimalayas(opts: { sleep?: (ms: number) => Promise<void> } = {}): AnyAdapter {
  const sleep = opts.sleep ?? defaultSleep;

  const adapter: SourceAdapter<Raw> = {
    id: "himalayas",
    name: "Himalayas",
    homepage: "https://himalayas.app",
    minIntervalMinutes: 60,
    techFilter: true,
    itemSchema: ItemSchema,

    async fetch({ http, latestPostedAt }) {
      const items: unknown[] = [];
      let cursor: string | null = null;
      for (let page = 1; page <= MAX_PAGES; page++) {
        const url: string = cursor ? `${BASE_URL}&cursor=${encodeURIComponent(cursor)}` : BASE_URL;
        const body = EnvelopeSchema.parse(await http.getJson(url));
        items.push(...body.jobs);

        if (!body.nextCursor) break;
        if (latestPostedAt && body.jobs.some((j) => reachedKnownJobs(j, latestPostedAt))) break;
        cursor = body.nextCursor;
        if (page < MAX_PAGES) await sleep(PAGE_DELAY_MS);
      }
      return items;
    },

    normalize(raw) {
      const salaryMin = raw.minSalary || null;
      const salaryMax = raw.maxSalary || null;
      const hasSalary = salaryMin !== null || salaryMax !== null;
      return {
        source: "himalayas",
        externalId: raw.guid,
        url: raw.guid,
        applyUrl: raw.applicationLink,
        title: raw.title,
        company: raw.companyName,
        location: raw.locationRestrictions.join(", ") || null,
        workplaceType: "remote",
        departments: [],
        regions: [],
        employmentType: null,
        tags: normalizeTags([...raw.categories, ...raw.seniority]),
        salaryMin,
        salaryMax,
        salaryCurrency: hasSalary ? (raw.currency?.toUpperCase() ?? null) : null,
        salaryPeriod: hasSalary ? salaryPeriodFrom(raw.salaryPeriod) : null,
        descriptionHtml: raw.description,
        descriptionText: htmlToText(raw.description),
        postedAt: toIsoUtc(raw.pubDate),
      };
    },
  };

  return defineAdapter(adapter);
}

/** True when the job is older than the newest job we already stored. */
function reachedKnownJobs(job: unknown, latestPostedAt: string): boolean {
  const parsed = PubDateSchema.safeParse(job);
  if (!parsed.success) return false;
  const iso = toIsoUtc(parsed.data.pubDate);
  return iso !== null && iso < latestPostedAt;
}

export const himalayas = createHimalayas();
