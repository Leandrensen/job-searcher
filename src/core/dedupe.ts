import type { Job } from "./job";

const LEGAL_SUFFIX = /(?:,|\s)\s*(?:inc\.?|llc|ltd\.?|gmbh|s\.a\.|sa|corp|corporation|co\.?)\s*$/;

export function normalizeCompany(name: string): string {
  return name.toLowerCase().trim().replace(LEGAL_SUFFIX, "").replace(/[^\p{L}\p{N}]/gu, "");
}

export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function dedupeKey(job: Pick<Job, "company" | "title">): string {
  return `${normalizeCompany(job.company)}|${normalizeTitle(job.title)}`;
}
