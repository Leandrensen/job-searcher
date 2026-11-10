import { z } from "zod";
import { toIsoUtc } from "@/core/dates";
import { decodeEntities, htmlToText } from "@/core/text";
import { defineAdapter, type SourceAdapter } from "../types";

const SearchSchema = z.looseObject({
  hits: z.array(z.looseObject({ objectID: z.string(), title: z.string() })),
});
const ThreadSchema = z.looseObject({ children: z.array(z.unknown()) });
const HasTextSchema = z.object({ text: z.string().min(1) });

const ItemSchema = z.object({
  id: z.number(),
  text: z.string(),
  created_at: z.string(),
  author: z.string().nullish(),
});
type Raw = z.output<typeof ItemSchema>;

const adapter: SourceAdapter<Raw> = {
  id: "hn-hiring",
  name: "HN: Who is hiring?",
  homepage: "https://news.ycombinator.com",
  minIntervalMinutes: 360,
  techFilter: false,
  itemSchema: ItemSchema,

  async fetch({ http }) {
    const search = SearchSchema.parse(
      await http.getJson(
        "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=10",
      ),
    );
    const thread = search.hits.find((h) => h.title.startsWith("Ask HN: Who is hiring?"));
    if (!thread) throw new Error("No Who is hiring thread found");

    const body = ThreadSchema.parse(await http.getJson(`https://hn.algolia.com/api/v1/items/${thread.objectID}`));
    return body.children.filter((c) => HasTextSchema.safeParse(c).success);
  },

  normalize(raw) {
    const firstParagraph = raw.text.split(/<p>/i)[0] ?? "";
    const parts = htmlToText(firstParagraph)
      .split("|")
      .map((p) => p.trim());
    const company = parts[0];
    const title = parts[1];
    if (parts.length < 2 || !company || !title) return null;

    const header = parts.join(" | ");
    const remote = /\bremote\b/i.test(header) ? true : /\bon-?site\b/i.test(header) ? false : null;

    const href = /href="([^"]+)"/i.exec(raw.text)?.[1];
    const applyUrl = href && /^https?:\/\//i.test(decodeEntities(href)) ? decodeEntities(href) : null;

    return {
      source: "hn-hiring",
      externalId: String(raw.id),
      url: `https://news.ycombinator.com/item?id=${raw.id}`,
      applyUrl,
      title,
      company,
      location: parts[2] || null,
      remote,
      tags: [],
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      descriptionHtml: raw.text,
      descriptionText: htmlToText(raw.text.replace(/<p>/gi, "<br>")),
      postedAt: toIsoUtc(raw.created_at),
    };
  },
};

export const hnHiring = defineAdapter(adapter);
