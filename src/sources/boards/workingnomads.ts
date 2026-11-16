import { z } from "zod";
import { toIsoUtc } from "@/core/dates";
import { htmlToText, normalizeTags } from "@/core/text";
import { defineAdapter, type SourceAdapter } from "../types";

const EnvelopeSchema = z.array(z.unknown());

const ItemSchema = z.object({
  url: z.string(),
  title: z.string(),
  company_name: z.string(),
  description: z.string(),
  pub_date: z.string(),
  category_name: z.string().default(""),
  tags: z.string().default(""),
  location: z.string().default(""),
});
type Raw = z.output<typeof ItemSchema>;

const adapter: SourceAdapter<Raw> = {
  id: "workingnomads",
  name: "Working Nomads",
  homepage: "https://www.workingnomads.com",
  minIntervalMinutes: 60,
  techFilter: true,
  itemSchema: ItemSchema,

  async fetch({ http }) {
    // Keep the trailing slash.
    return EnvelopeSchema.parse(await http.getJson("https://www.workingnomads.com/api/exposed_jobs/"));
  },

  normalize(raw) {
    const idMatch = /\/job\/go\/(\d+)\//.exec(raw.url);
    return {
      source: "workingnomads",
      externalId: idMatch?.[1] ?? raw.url,
      url: raw.url,
      applyUrl: null,
      title: raw.title,
      company: raw.company_name,
      location: raw.location || null,
      workplaceType: "remote",
      departments: [],
      regions: [],
      employmentType: null,
      tags: normalizeTags([...raw.tags.split(","), raw.category_name]),
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      descriptionHtml: raw.description,
      descriptionText: htmlToText(raw.description),
      postedAt: toIsoUtc(raw.pub_date),
    };
  },
};

export const workingnomads = defineAdapter(adapter);
