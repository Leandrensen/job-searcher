import { stripLegalSuffixes } from "@/core/dedupe";
import type { AtsId } from "@/core/job";

export interface AtsRef {
  ats: AtsId;
  slug: string;
}

interface UrlPattern {
  ats: AtsId;
  re: RegExp;
  ignored: string[];
  keepCase?: boolean;
}

const PATTERNS: UrlPattern[] = [
  {
    ats: "greenhouse",
    re: /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_app\?for=)?([a-z0-9_-]+)/gi,
    ignored: ["embed", "api"],
  },
  { ats: "lever", re: /jobs\.(?:eu\.)?lever\.co\/([a-z0-9_.-]+?)(?=[/?#"'\s]|$)/gi, ignored: [] },
  { ats: "ashby", re: /jobs\.ashbyhq\.com\/([a-z0-9_.-]+)/gi, ignored: ["api"] },
  { ats: "workable", re: /apply\.workable\.com\/([a-z0-9_-]+)/gi, ignored: ["j", "api"] },
  { ats: "recruitee", re: /https?:\/\/([a-z0-9-]+)\.recruitee\.com/gi, ignored: ["www", "app", "api"] },
  {
    ats: "smartrecruiters",
    re: /jobs\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/g,
    ignored: ["oneclick-ui", "api"],
    keepCase: true,
  },
];

/** All ATS company refs in a text, unique by ats+slug, in order of appearance. */
export function extractAtsRefs(text: string): AtsRef[] {
  const cleaned = text.replace(/&#x2F;/gi, "/").replace(/\\\//g, "/");
  const found: { index: number; ref: AtsRef }[] = [];
  for (const p of PATTERNS) {
    for (const m of cleaned.matchAll(p.re)) {
      const raw = (m[1] ?? "").replace(/\.+$/, "");
      const slug = p.keepCase ? raw : raw.toLowerCase();
      if (!slug || p.ignored.includes(slug.toLowerCase())) continue;
      found.push({ index: m.index ?? 0, ref: { ats: p.ats, slug } });
    }
  }
  found.sort((a, b) => a.index - b.index);
  const seen = new Set<string>();
  const refs: AtsRef[] = [];
  for (const { ref } of found) {
    const key = `${ref.ats}/${ref.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }
  return refs;
}

export function parseAtsUrl(url: string): AtsRef | null {
  return extractAtsRefs(url)[0] ?? null;
}

/** Hostname in lowercase without a leading "www.", or null if the value isn't a usable URL. */
export function websiteDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url.includes("://") ? url : `https://${url}`).hostname.toLowerCase();
    return host.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** At most 3 likely ATS slugs for a company, most likely first. */
export function slugGuesses(name: string, website: string | null): string[] {
  const n = stripLegalSuffixes(name).replace(/&/g, " and ").trim();
  const compact = n.replace(/[^a-z0-9]/g, "");
  const dashed = n.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const domainLabel = websiteDomain(website)?.split(".")[0] ?? "";
  const guesses = [compact, dashed, domainLabel.length >= 2 ? domainLabel : ""].filter(Boolean);
  return [...new Set(guesses)].slice(0, 3);
}
