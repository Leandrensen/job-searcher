import Parser from "rss-parser";
import { z } from "zod";
import { toIsoUtc } from "@/core/dates";
import { htmlToText, normalizeTags } from "@/core/text";
import { defineAdapter, type SourceAdapter } from "../types";

const FEED_BASE = "https://weworkremotely.com/categories/";
const FEEDS = [
  "remote-programming-jobs.rss",
  "remote-full-stack-programming-jobs.rss",
  "remote-back-end-programming-jobs.rss",
  "remote-front-end-programming-jobs.rss",
  "remote-devops-sysadmin-jobs.rss",
];

const ItemSchema = z.object({
  title: z.string(),
  link: z.string(),
  guid: z.string(),
  pubDate: z.string(),
  content: z.string().optional(),
  description: z.string().optional(),
  region: z.string().optional(),
  category: z.string().optional(),
});
type Raw = z.output<typeof ItemSchema>;

const adapter: SourceAdapter<Raw> = {
  id: "weworkremotely",
  name: "We Work Remotely",
  homepage: "https://weworkremotely.com",
  minIntervalMinutes: 60,
  techFilter: false,
  itemSchema: ItemSchema,

  async fetch({ http, log }) {
    const parser = new Parser({ customFields: { item: ["region", "category"] } });
    const items: unknown[] = [];
    let failures = 0;
    for (const feed of FEEDS) {
      try {
        const xml = await http.getText(FEED_BASE + feed);
        const parsed = await parser.parseString(xml);
        items.push(...parsed.items);
      } catch (err) {
        failures++;
        log(`weworkremotely: feed ${feed} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (failures === FEEDS.length) throw new Error(`All ${FEEDS.length} feeds failed`);
    return items;
  },

  normalize(raw) {
    const sep = raw.title.indexOf(": ");
    if (sep < 0) return null;
    const html = raw.content ?? raw.description ?? "";
    return {
      source: "weworkremotely",
      externalId: raw.guid,
      url: raw.link,
      applyUrl: null,
      title: raw.title.slice(sep + 2).trim(),
      company: raw.title.slice(0, sep).trim(),
      location: raw.region ?? null,
      workplaceType: "remote",
      departments: [],
      regions: [],
      employmentType: null,
      tags: normalizeTags([raw.category]),
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      descriptionHtml: html,
      descriptionText: htmlToText(html),
      postedAt: toIsoUtc(raw.pubDate),
    };
  },
};

export const weworkremotely = defineAdapter(adapter);
