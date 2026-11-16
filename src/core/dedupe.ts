import type { Job } from "./job";

const LEGAL_SUFFIXES = [
  "inc", "inc.", "incorporated", "llc", "l.l.c.", "ltd", "ltd.", "limited", "gmbh", "ag",
  "s.a.", "sa", "s.l.", "plc", "bv", "b.v.", "corp", "corp.", "corporation", "co", "co.",
];
const MAX_SUFFIX_PASSES = 3;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A suffix only counts when it follows a comma or whitespace and ends the name.
const LEGAL_SUFFIX = new RegExp(`(?:,|\\s)\\s*(?:${LEGAL_SUFFIXES.map(escapeRegExp).join("|")})\\s*$`);

/** Lowercased, trimmed name with trailing legal suffixes (Inc., Ltd., GmbH, ...) removed. Punctuation is kept. */
export function stripLegalSuffixes(name: string): string {
  let current = name.toLowerCase().trim();
  for (let pass = 0; pass < MAX_SUFFIX_PASSES; pass++) {
    const stripped = current.replace(LEGAL_SUFFIX, "").replace(/[,\s]+$/, "");
    if (stripped === current || stripped === "") break;
    current = stripped;
  }
  return current;
}

export function normalizeCompany(name: string): string {
  return stripLegalSuffixes(name).replace(/[^\p{L}\p{N}]/gu, "");
}

export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function dedupeKey(job: Pick<Job, "company" | "title">): string {
  return `${normalizeCompany(job.company)}|${normalizeTitle(job.title)}`;
}
