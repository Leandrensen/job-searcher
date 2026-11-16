import { z } from "zod";
import { toIsoUtc } from "@/core/dates";
import { decodeEntities, htmlToText, normalizeTags } from "@/core/text";
import { defineAdapter, type SourceAdapter } from "../types";

const EnvelopeSchema = z.array(z.unknown());

const ItemSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  position: z.string(),
  company: z.string(),
  url: z.string(),
  apply_url: z.string().optional(),
  description: z.string().default(""),
  tags: z.array(z.string()).default([]),
  location: z.string().default(""),
  salary_min: z.number().default(0),
  salary_max: z.number().default(0),
  date: z.string(),
});
type Raw = z.output<typeof ItemSchema>;

const adapter: SourceAdapter<Raw> = {
  id: "remoteok",
  name: "Remote OK",
  homepage: "https://remoteok.com",
  minIntervalMinutes: 60,
  techFilter: true,
  itemSchema: ItemSchema,

  async fetch({ http }) {
    const body = EnvelopeSchema.parse(await http.getJson("https://remoteok.com/api"));
    // Element 0 is a legal notice, not a job.
    return body.filter((el) => typeof el === "object" && el !== null && "id" in el);
  },

  normalize(raw) {
    const salaryMin = raw.salary_min > 0 ? raw.salary_min : null;
    const salaryMax = raw.salary_max > 0 ? raw.salary_max : null;
    const hasSalary = salaryMin !== null || salaryMax !== null;
    return {
      source: "remoteok",
      externalId: raw.id,
      url: raw.url,
      applyUrl: raw.apply_url || null,
      title: decodeEntities(raw.position),
      company: decodeEntities(raw.company),
      location: raw.location || null,
      workplaceType: "remote",
      departments: [],
      regions: [],
      employmentType: null,
      tags: normalizeTags(raw.tags),
      salaryMin,
      salaryMax,
      salaryCurrency: hasSalary ? "USD" : null,
      salaryPeriod: hasSalary ? "year" : null,
      descriptionHtml: raw.description,
      descriptionText: htmlToText(raw.description),
      postedAt: toIsoUtc(raw.date),
    };
  },
};

export const remoteok = defineAdapter(adapter);
