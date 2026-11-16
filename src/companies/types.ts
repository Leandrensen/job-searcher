import type { HttpClient } from "@/core/http";
import type { AtsId } from "@/core/job";
import type { AtsRef } from "./slugs";

/** Outcome of trying to resolve a candidate company to an ATS board. */
export type Resolution =
  | { status: "confirmed"; ats: AtsId; slug: string; companyName: string | null }
  | { status: "ambiguous"; matches: AtsRef[] }
  | { status: "not_found" }
  | { status: "error"; error: string };

/** What probing one ATS board slug tells us. */
export interface ProbeResult {
  exists: boolean;
  postingCount: number;
  /** The company name the ATS reports, when it reports one. */
  companyName: string | null;
  /** Plain-text descriptions of up to 5 postings. */
  texts: string[];
  /** URLs of those postings. */
  urls: string[];
}

export type ProbeFn = (http: HttpClient, slug: string) => Promise<ProbeResult>;
