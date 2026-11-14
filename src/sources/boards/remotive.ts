import { z } from "zod";
import { toIsoUtc } from "@/core/dates";
import { htmlToText, normalizeTags } from "@/core/text";
import { defineAdapter, type SourceAdapter } from "../types";

const EnvelopeSchema = z.looseObject({ jobs: z.array(z.unknown()) });

const ItemSchema = z.object({
  id: z.number(),
  url: z.string(),
  title: z.string(),
  company_name: z.string(),
  category: z.string(),
  tags: z.array(z.string()).default([]),
  candidate_required_location: z.string().default(""),
  description: z.string(),
  publication_date: z.string(),
});
type Raw = z.output<typeof ItemSchema>;

const adapter: SourceAdapter<Raw> = {
  id: "remotive",
  name: "Remotive",
  homepage: "https://remotive.com",
  // Their terms: at most ~4 calls a day. Never lower this.
  minIntervalMinutes: 360,
  techFilter: true,
  itemSchema: ItemSchema,

  async fetch({ http }) {
    const body = EnvelopeSchema.parse(await http.getJson("https://remotive.com/api/remote-jobs"));
    return body.jobs;
  },

  normalize(raw) {
    return {
      source: "remotive",
      externalId: String(raw.id),
      url: raw.url,
      applyUrl: null,
      title: raw.title,
      company: raw.company_name,
      location: raw.candidate_required_location || null,
      remote: true,
      tags: normalizeTags([...raw.tags, raw.category]),
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      descriptionHtml: raw.description,
      descriptionText: htmlToText(raw.description),
      postedAt: toIsoUtc(raw.publication_date),
    };
  },
};

export const remotive = defineAdapter(adapter);
