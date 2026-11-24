import { z } from "zod";
import { toIsoUtc } from "@/core/dates";
import type { HttpClient } from "@/core/http";
import type { WorkplaceType } from "@/core/job";
import { checkLocation } from "@/core/location-filter";
import { deriveRegions, deriveWorkplaceType } from "@/core/locations";
import { checkJobRules } from "@/core/job-filter-rules";
import { htmlToText } from "@/core/text";
import type { ProbeResult } from "@/companies/types";
import { defineAdapter, type SourceAdapter } from "../types";
import { displayLocation, NOT_FOUND_PROBE, nullOn404, requireCompanies, uniqueNonEmpty, wrapperSchema } from "./shared";

const PAGE_SIZE = 100;
const MAX_PAGES = 50;
const postingsUrl = (slug: string) => `https://api.smartrecruiters.com/v1/companies/${slug}/postings`;

const EnvelopeSchema = z.looseObject({
  totalFound: z.number(),
  offset: z.number().default(0),
  limit: z.number().default(PAGE_SIZE),
  content: z.array(z.unknown()),
});

const Label = z.object({ label: z.string().nullish() }).nullish();

const ListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  releasedDate: z.string().nullish(),
  department: Label,
  function: Label,
  typeOfEmployment: Label,
  location: z.object({
    fullLocation: z.string().nullish(),
    remote: z.boolean().nullish(),
    hybrid: z.boolean().nullish(),
  }),
});
type ListItem = z.output<typeof ListItemSchema>;

const DetailSchema = z.object({
  postingUrl: z.string(),
  applyUrl: z.string().nullish(),
  jobAd: z.object({ sections: z.record(z.string(), z.object({ title: z.string().nullish(), text: z.string().nullish() })) }),
});

const ItemSchema = z.object({ list: ListItemSchema, detail: DetailSchema });
const WrappedSchema = wrapperSchema(ItemSchema);
type Raw = z.output<typeof WrappedSchema>;

const SECTION_ORDER = ["companyDescription", "jobDescription", "qualifications", "additionalInformation"];

const departmentsOf = (list: ListItem) => uniqueNonEmpty([list.department?.label, list.function?.label]);
const textsOf = (list: ListItem) => [list.location.fullLocation ?? ""];
const workplaceOf = (list: ListItem): WorkplaceType => (list.location.remote ? "remote" : list.location.hybrid ? "hybrid" : "onsite");

const ProbeItemSchema = z.looseObject({ id: z.string(), company: z.object({ name: z.string() }) });

const adapter: SourceAdapter<Raw> = {
  id: "smartrecruiters",
  name: "SmartRecruiters",
  homepage: "https://www.smartrecruiters.com",
  minIntervalMinutes: 0, // unused: ATS pacing is per company
  techFilter: false, // the ATS runner applies the storage filters

  itemSchema: WrappedSchema,

  async fetch(ctx) {
    const items: unknown[] = [];
    const rules = ctx.rules;
    if (!rules) throw new Error("smartrecruiters: ctx.rules is required");
    for (const company of requireCompanies(ctx, "smartrecruiters")) {
      const base = postingsUrl(company.slug);
      let offset = 0;
      for (let page = 0; page < MAX_PAGES; page++) {
        const body = EnvelopeSchema.parse(await ctx.http.getJson(`${base}?limit=${PAGE_SIZE}&offset=${offset}`));
        // A partial listing would make the runner close every job past the cutoff, so refuse it up front.
        if (page === 0 && body.totalFound > MAX_PAGES * PAGE_SIZE) {
          throw new Error(`smartrecruiters/${company.slug}: ${body.totalFound} postings, more than the ${MAX_PAGES * PAGE_SIZE} this adapter can list`);
        }
        for (const raw of body.content) {
          const parsed = ListItemSchema.safeParse(raw);
          // Leave unparseable items to the pipeline, which counts them as invalid.
          if (!parsed.success) {
            items.push({ company, item: { list: raw, detail: null } });
            continue;
          }
          const list = parsed.data;
          // The list has no description, so filter on what it does have before spending a request per posting.
          const partial = { title: list.name, departments: departmentsOf(list), tags: [] as string[] };
          const regions = deriveRegions(textsOf(list));
          // SmartRecruiters' public API has no salary (list or detail), so salary rules never apply here: unknown values pass.
          if (!checkJobRules({ ...partial, salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null }, rules).pass) {
            ctx.onPrefiltered?.("rules");
            continue;
          }
          if (!checkLocation({ workplaceType: workplaceOf(list), regions }, company.homeCountry).pass) {
            ctx.onPrefiltered?.("location");
            continue;
          }
          // A posting can be unpublished between the list call and its detail call; that must not fail the company.
          const detail = await nullOn404(() => ctx.http.getJson(`${base}/${list.id}`));
          if (detail === null) {
            ctx.log(`smartrecruiters/${company.slug}: posting ${list.id} is gone, skipped`);
            continue;
          }
          items.push({ company, item: { list: raw, detail } });
        }
        offset = body.offset + body.limit;
        if (offset >= body.totalFound) break;
      }
    }
    return items;
  },

  normalize({ company, item }) {
    const { list, detail } = item;
    const texts = textsOf(list);
    const descriptionHtml = SECTION_ORDER.map((k) => detail.jobAd.sections[k]?.text ?? "")
      .filter((t) => t !== "")
      .join("\n");
    return {
      source: "smartrecruiters",
      externalId: `${company.slug}:${list.id}`,
      url: detail.postingUrl,
      applyUrl: detail.applyUrl ?? null,
      title: list.name.trim(),
      company: company.name,
      location: displayLocation(texts),
      workplaceType: deriveWorkplaceType(workplaceOf(list), texts),
      departments: departmentsOf(list),
      regions: deriveRegions(texts),
      employmentType: list.typeOfEmployment?.label ?? null,
      tags: [],
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      descriptionHtml,
      descriptionText: htmlToText(descriptionHtml),
      postedAt: toIsoUtc(list.releasedDate),
    };
  },
};

export const smartrecruiters = defineAdapter(adapter);

export async function probeSmartRecruiters(http: HttpClient, slug: string): Promise<ProbeResult> {
  const body = await nullOn404(() => http.getJson(`${postingsUrl(slug)}?limit=10`));
  if (body === null) return NOT_FOUND_PROBE;
  const { totalFound, content } = EnvelopeSchema.parse(body);
  // SmartRecruiters answers 200 with no postings for unknown slugs, so "no postings" means "not there".
  if (totalFound === 0) return NOT_FOUND_PROBE;
  const sample = content.slice(0, 5).map((c) => ProbeItemSchema.parse(c));
  return {
    exists: true,
    postingCount: totalFound,
    companyName: sample[0]?.company.name ?? null,
    texts: [],
    urls: sample.map((c) => `https://jobs.smartrecruiters.com/${slug}/${c.id}`),
  };
}
