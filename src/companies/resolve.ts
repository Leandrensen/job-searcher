import { normalizeCompany, stripLegalSuffixes } from "@/core/dedupe";
import type { HttpClient } from "@/core/http";
import type { AtsId } from "@/core/job";
import { extractAtsRefs, slugGuesses, websiteDomain, type AtsRef } from "./slugs";
import type { ProbeFn, ProbeResult, Resolution } from "./types";

export type Candidate = { name: string; website: string | null; careersUrl: string | null; atsHints: string[] };

/** Order in which guessed slugs are tried against the ATSs. */
export const PROBE_ORDER: readonly AtsId[] = ["greenhouse", "lever", "ashby", "recruitee", "smartrecruiters"];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether an ATS board that exists really belongs to this candidate. Precision first. */
export function proveIdentity(candidate: Candidate, ats: AtsId, probe: ProbeResult): boolean {
  // 1. The ATS reports the same company name.
  const wanted = normalizeCompany(candidate.name);
  if (probe.companyName !== null && wanted !== "" && normalizeCompany(probe.companyName) === wanted) return true;

  // 2. The company's website domain shows up in the ATS data.
  const domain = websiteDomain(candidate.website);
  if (domain !== null) {
    const onDomain = probe.urls.some((u) => {
      try {
        const host = new URL(u).hostname.toLowerCase();
        return host === domain || host.endsWith(`.${domain}`);
      } catch {
        return false;
      }
    });
    // In text the domain must be a whole host (subdomains allowed): "x.com" must not match "dropbox.com".
    const domainRe = new RegExp(`(?<![a-z0-9-])${escapeRegExp(domain)}(?![a-z0-9-]|\\.[a-z0-9])`, "i");
    if (onDomain || probe.texts.some((t) => domainRe.test(t))) return true;
  }

  // 3. Lever and Ashby return no company name: the name must appear in at least 2 postings (or in the only one).
  // The legal suffix is dropped ("Globex, Inc." -> "globex"), because postings say "Globex".
  const bareName = stripLegalSuffixes(candidate.name);
  if ((ats === "lever" || ats === "ashby") && probe.texts.length >= 1 && bareName !== "") {
    const nameRe = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(bareName)}(?![\\p{L}\\p{N}])`, "iu");
    const mentions = probe.texts.filter((t) => nameRe.test(t)).length;
    if (mentions >= Math.min(2, probe.texts.length)) return true;
  }
  return false;
}

/**
 * Resolve a candidate to an ATS board. No DB access.
 * 1. Direct ATS links from the company's own data are used first.
 * 2. Otherwise up to 3 slug guesses are probed against every ATS; a board only counts if identity is proven.
 */
export async function resolveCandidate(
  http: HttpClient,
  candidate: Candidate,
  probes: Record<AtsId, ProbeFn>,
): Promise<Resolution> {
  const probed = new Set<string>();
  let firstError: string | null = null;

  async function tryProbe(ats: AtsId, slug: string): Promise<ProbeResult | null> {
    probed.add(`${ats}/${slug}`);
    try {
      return await probes[ats](http, slug);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      firstError ??= `${e.name}: ${e.message}`;
      return null;
    }
  }

  // 1. Direct links. They come from the company's own data or posting, so an existing board is proof enough.
  const direct = extractAtsRefs([candidate.careersUrl, candidate.website, ...candidate.atsHints].filter(Boolean).join(" "));
  for (const ref of direct) {
    const probe = await tryProbe(ref.ats, ref.slug);
    if (probe?.exists && (ref.ats !== "smartrecruiters" || probe.postingCount > 0)) {
      return { status: "confirmed", ats: ref.ats, slug: ref.slug, companyName: probe.companyName };
    }
  }

  // 2. Guessed slugs.
  const unproven: AtsRef[] = [];
  for (const slug of slugGuesses(candidate.name, candidate.website)) {
    for (const ats of PROBE_ORDER) {
      if (probed.has(`${ats}/${slug}`)) continue;
      const probe = await tryProbe(ats, slug);
      if (!probe?.exists) continue;
      if (proveIdentity(candidate, ats, probe)) {
        return { status: "confirmed", ats, slug, companyName: probe.companyName };
      }
      // An empty board without a name proves nothing and says nothing, so it doesn't count as a match.
      if (probe.postingCount > 0 || probe.companyName !== null) unproven.push({ ats, slug });
    }
  }

  // A failed probe may have hidden the real board, so retry later instead of sending the candidate to manual review.
  if (firstError !== null) return { status: "error", error: firstError };
  if (unproven.length > 0) return { status: "ambiguous", matches: unproven };
  return { status: "not_found" };
}
