import { z } from "zod";
import { toIsoUtc } from "@/core/dates";
import { htmlToText, normalizeTags } from "@/core/text";
import { defineAdapter, type SourceAdapter } from "../types";

const CATEGORIES = [
  "programming",
  "sysadmin-devops-qa",
  "mobile-developer",
  "data-science-analytics",
  "machine-learning-ai",
  "cybersecurity",
];
const MAX_PAGES_PER_CATEGORY = 3;

const EnvelopeSchema = z.object({
  data: z.array(z.unknown()),
  meta: z.object({ page: z.number(), total_pages: z.number() }),
});

const ItemSchema = z.object({
  id: z.string(),
  links: z.object({ public_url: z.string() }),
  attributes: z.object({
    title: z.string(),
    description: z.string().nullish(),
    functions: z.string().nullish(),
    desirable: z.string().nullish(),
    benefits: z.string().nullish(),
    remote_modality: z.string().nullish(),
    countries: z.array(z.string()).default([]),
    min_salary: z.number().nullish(),
    max_salary: z.number().nullish(),
    published_at: z.number(),
    category_name: z.string().nullish(),
    company: z
      .object({ data: z.object({ attributes: z.object({ name: z.string() }).optional() }).optional() })
      .optional(),
  }),
});
type Raw = z.output<typeof ItemSchema>;

function remoteFrom(modality: string | null | undefined): boolean | null {
  switch (modality) {
    case "fully_remote":
    case "remote_local":
      return true;
    case "hybrid":
    case "no_remote":
      return false;
    default:
      return null;
  }
}

const adapter: SourceAdapter<Raw> = {
  id: "getonboard",
  name: "Get on Board",
  homepage: "https://www.getonbrd.com",
  minIntervalMinutes: 60,
  techFilter: false,
  itemSchema: ItemSchema,

  async fetch({ http }) {
    const items: unknown[] = [];
    for (const category of CATEGORIES) {
      for (let page = 1; page <= MAX_PAGES_PER_CATEGORY; page++) {
        const url = `https://www.getonbrd.com/api/v0/categories/${category}/jobs?per_page=100&page=${page}&expand=%5B%22company%22%5D`;
        const body = EnvelopeSchema.parse(await http.getJson(url));
        items.push(...body.data);
        if (page >= body.meta.total_pages) break;
      }
    }
    return items;
  },

  normalize(raw) {
    const a = raw.attributes;
    const html = [a.description, a.functions, a.desirable, a.benefits].filter(Boolean).join("\n");
    const salaryMin = a.min_salary || null;
    const salaryMax = a.max_salary || null;
    const hasSalary = salaryMin !== null || salaryMax !== null;
    return {
      source: "getonboard",
      externalId: raw.id,
      url: raw.links.public_url,
      applyUrl: null,
      title: a.title,
      company: a.company?.data?.attributes?.name ?? "Unknown",
      location: a.countries.join(", ") || null,
      remote: remoteFrom(a.remote_modality),
      tags: normalizeTags([a.category_name]),
      salaryMin,
      salaryMax,
      salaryCurrency: hasSalary ? "USD" : null,
      salaryPeriod: hasSalary ? "month" : null,
      descriptionHtml: html,
      descriptionText: htmlToText(html),
      postedAt: toIsoUtc(a.published_at),
    };
  },
};

export const getonboard = defineAdapter(adapter);
