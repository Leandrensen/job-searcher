import { z } from "zod";

export const BOARD_IDS = [
  "remoteok",
  "weworkremotely",
  "remotive",
  "himalayas",
  "jobicy",
  "workingnomads",
  "arbeitnow",
] as const;
export const ATS_IDS = ["greenhouse", "lever", "ashby", "recruitee", "smartrecruiters"] as const;
export const SOURCE_IDS = [...BOARD_IDS, ...ATS_IDS] as const;
export type BoardId = (typeof BOARD_IDS)[number];
export type AtsId = (typeof ATS_IDS)[number];
export type SourceId = (typeof SOURCE_IDS)[number];

export const WORKPLACE_TYPES = ["remote", "hybrid", "onsite"] as const;
export type WorkplaceType = (typeof WORKPLACE_TYPES)[number];

export const JobSchema = z.object({
  source: z.enum(SOURCE_IDS),
  externalId: z.string().min(1),
  /** Original posting URL on the source (attribution link). */
  url: z.url(),
  applyUrl: z.url().nullable(),
  title: z.string().min(1),
  company: z.string().min(1),
  /** Free text as given by the source. */
  location: z.string().nullable(),
  /** null = unknown. */
  workplaceType: z.enum(WORKPLACE_TYPES).nullable(),
  departments: z.array(z.string()),
  /** Our own region vocabulary, derived from the location text. */
  regions: z.array(z.string()),
  employmentType: z.string().nullable(),
  /** Always passed through normalizeTags. */
  tags: z.array(z.string()),
  salaryMin: z.number().positive().nullable(),
  salaryMax: z.number().positive().nullable(),
  /** ISO 4217, uppercase. */
  salaryCurrency: z.string().length(3).regex(/^[A-Z]{3}$/).nullable(),
  salaryPeriod: z.enum(["year", "month", "hour"]).nullable(),
  descriptionHtml: z.string(),
  descriptionText: z.string(),
  postedAt: z.iso.datetime().nullable(),
});
export type Job = z.infer<typeof JobSchema>;

export function salaryPeriodFrom(raw: string | null | undefined): Job["salaryPeriod"] {
  switch (raw?.toLowerCase()) {
    case "annual":
    case "yearly":
    case "year":
      return "year";
    case "monthly":
    case "month":
      return "month";
    case "hourly":
    case "hour":
      return "hour";
    default:
      return null;
  }
}
