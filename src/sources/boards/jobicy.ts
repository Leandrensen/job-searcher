import { z } from "zod";
import { toIsoUtc } from "@/core/dates";
import { salaryPeriodFrom } from "@/core/job";
import { decodeEntities, htmlToText, normalizeTags } from "@/core/text";
import { defineAdapter, type SourceAdapter } from "../types";

const EnvelopeSchema = z.looseObject({ jobs: z.array(z.unknown()) });

const ItemSchema = z.object({
  id: z.number(),
  url: z.string(),
  jobTitle: z.string(),
  companyName: z.string(),
  jobDescription: z.string(),
  pubDate: z.string(),
  jobGeo: z.string().default(""),
  jobIndustry: z.array(z.string()).default([]),
  jobType: z.array(z.string()).default([]),
  jobLevel: z.string().optional(),
  salaryMin: z.number().optional(),
  salaryMax: z.number().optional(),
  salaryCurrency: z.string().optional(),
  salaryPeriod: z.string().optional(),
});
type Raw = z.output<typeof ItemSchema>;

const adapter: SourceAdapter<Raw> = {
  id: "jobicy",
  name: "Jobicy",
  homepage: "https://jobicy.com",
  minIntervalMinutes: 60,
  techFilter: true,
  itemSchema: ItemSchema,

  async fetch({ http }) {
    const body = EnvelopeSchema.parse(
      await http.getJson("https://jobicy.com/api/v2/remote-jobs?count=100&industry=dev"),
    );
    return body.jobs;
  },

  normalize(raw) {
    const salaryMin = raw.salaryMin || null;
    const salaryMax = raw.salaryMax || null;
    const hasSalary = salaryMin !== null || salaryMax !== null;
    return {
      source: "jobicy",
      externalId: String(raw.id),
      url: raw.url,
      applyUrl: null,
      title: decodeEntities(raw.jobTitle),
      company: decodeEntities(raw.companyName),
      location: raw.jobGeo || null,
      workplaceType: "remote",
      departments: [],
      regions: [],
      employmentType: null,
      tags: normalizeTags([...raw.jobIndustry, ...raw.jobType, raw.jobLevel]),
      salaryMin,
      salaryMax,
      salaryCurrency: hasSalary ? (raw.salaryCurrency?.toUpperCase() ?? null) : null,
      salaryPeriod: hasSalary ? salaryPeriodFrom(raw.salaryPeriod) : null,
      descriptionHtml: raw.jobDescription,
      descriptionText: htmlToText(raw.jobDescription),
      postedAt: toIsoUtc(raw.pubDate),
    };
  },
};

export const jobicy = defineAdapter(adapter);
