import type { z } from "zod";
import type { HttpClient } from "@/core/http";
import type { AtsId, Job, SourceId } from "@/core/job";

/** A company whose ATS board an ATS adapter should fetch. */
export interface CompanyRef {
  id: number;
  ats: AtsId;
  slug: string;
  name: string;
  homeCountry: string | null;
}

export interface FetchContext {
  http: HttpClient;
  /** ATS adapters only: the companies to fetch. */
  companies?: CompanyRef[];
  /** Max postedAt already stored for this source, or null. */
  latestPostedAt: string | null;
  log: (msg: string) => void;
}

export interface SourceAdapter<Raw> {
  id: SourceId;
  /** Display name, e.g. "Remote OK". */
  name: string;
  /** e.g. "https://remoteok.com". */
  homepage: string;
  /** The runner skips the source if its last successful run is more recent than this. */
  minIntervalMinutes: number;
  /** True for sources that mix IT and non-IT jobs. */
  techFilter: boolean;
  /** Validates ONE raw item. */
  itemSchema: z.ZodType<Raw>;
  /** Returns raw items; validates the response envelope itself. */
  fetch(ctx: FetchContext): Promise<unknown[]>;
  /** null = item unusable, skip it. */
  normalize(raw: Raw): Job | null;
}

export type AnyAdapter = SourceAdapter<unknown>;

/** Returns `a`; the only place the Raw type is erased. */
export function defineAdapter<Raw>(a: SourceAdapter<Raw>): AnyAdapter {
  return a as unknown as AnyAdapter;
}

export interface FetchResult {
  source: SourceId;
  status: "success" | "error" | "skipped";
  /** Raw items returned by fetch(). */
  fetched: number;
  /** Items rejected by itemSchema, by normalize returning null, or by JobSchema. */
  invalid: number;
  /** Items dropped by the tech filter. */
  filtered: number;
  jobs: Job[];
  /** Newest postedAt among every valid job, including ones the filters dropped. */
  latestPostedAt: string | null;
  error: string | null;
  /** HTTP status when fetch() failed with an HttpError; absent otherwise. */
  httpStatus?: number;
  durationMs: number;
}
