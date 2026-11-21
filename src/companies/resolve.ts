import { normalizeCompany, stripLegalSuffixesKeepCase } from "@/core/dedupe";
import { errorMessage } from "@/core/errors";
import { HttpError, type HttpClient } from "@/core/http";
import type { AtsId } from "@/core/job";
import { extractAtsRefs, slugGuesses, websiteDomain, type AtsRef } from "./slugs";
import type { ProbeFn, ProbeResult, Resolution } from "./types";

export type Candidate = { name: string; website: string | null; careersUrl: string | null; atsHints: string[] };

/** Thrown instead of probing an ATS that rate-limited us earlier in the run. */
export class RateLimitedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitedError";
  }
}

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
  // The legal suffix is dropped ("Globex, Inc." -> "Globex"), because postings say "Globex". The match is
  // case-sensitive and a hyphen joins words, so "Ramp" doesn't match "ramp up" and "Front" doesn't match "front-end".
  const bareName = stripLegalSuffixesKeepCase(candidate.name);
  if ((ats === "lever" || ats === "ashby") && probe.texts.length >= 1 && bareName !== "") {
    const nameRe = new RegExp(`(?<![\\p{L}\\p{N}-])${escapeRegExp(bareName)}(?![\\p{L}\\p{N}]|-[\\p{L}\\p{N}])`, "u");
    const mentions = probe.texts.filter((t) => nameRe.test(t)).length;
    if (mentions >= Math.min(2, probe.texts.length)) return true;
  }
  return false;
}

/**
 * Resolve a candidate to an ATS board. No DB access.
 * 1. ATS links from the company's own careers URL or website: an existing board is enough.
 * 2. ATS links found in board postings: identity must be proven, since a posting can link another company's board.
 * 3. Otherwise up to 3 slug guesses are probed against every ATS; a board only counts if identity is proven.
 */
export async function resolveCandidate(
  http: HttpClient,
  candidate: Candidate,
  probes: Record<AtsId, ProbeFn>,
): Promise<Resolution> {
  const probed = new Set<string>();
  let firstError: string | null = null;
  // Stays true while every probe failure is a rate limit, which says nothing about the candidate itself.
  let onlyRateLimits = true;

  async function tryProbe(ats: AtsId, slug: string): Promise<ProbeResult | null> {
    probed.add(`${ats}/${slug}`);
    try {
      return await probes[ats](http, slug);
    } catch (err) {
      firstError ??= errorMessage(err);
      if (!((err instanceof HttpError && err.status === 429) || err instanceof RateLimitedError)) onlyRateLimits = false;
      return null;
    }
  }

  // 1. Links from the company's own data: an existing board is proof enough.
  const trusted = extractAtsRefs([candidate.careersUrl, candidate.website].filter(Boolean).join(" "));
  for (const ref of trusted) {
    const probe = await tryProbe(ref.ats, ref.slug);
    if (probe?.exists && (ref.ats !== "smartrecruiters" || probe.postingCount > 0)) {
      return { status: "confirmed", ats: ref.ats, slug: ref.slug, companyName: probe.companyName };
    }
  }

  // An empty board without a name proves nothing and says nothing, so it doesn't count as a match.
  const unproven: AtsRef[] = [];
  const consider = (ats: AtsId, slug: string, probe: ProbeResult | null): Resolution | null => {
    if (!probe?.exists) return null;
    if (proveIdentity(candidate, ats, probe)) return { status: "confirmed", ats, slug, companyName: probe.companyName };
    if (probe.postingCount > 0 || probe.companyName !== null) unproven.push({ ats, slug });
    return null;
  };

  // 2. Links found in board postings. A posting can link someone else's board (an agency's client), so prove identity.
  const trustedKeys = new Set(trusted.map((r) => `${r.ats}/${r.slug}`));
  const hinted = extractAtsRefs(candidate.atsHints.join(" ")).filter((r) => !trustedKeys.has(`${r.ats}/${r.slug}`));
  for (const ref of hinted) {
    const confirmed = consider(ref.ats, ref.slug, await tryProbe(ref.ats, ref.slug));
    if (confirmed) return confirmed;
  }

  // 3. Guessed slugs.
  for (const slug of slugGuesses(candidate.name, candidate.website)) {
    for (const ats of PROBE_ORDER) {
      if (probed.has(`${ats}/${slug}`)) continue;
      const confirmed = consider(ats, slug, await tryProbe(ats, slug));
      if (confirmed) return confirmed;
    }
  }

  // A failed probe may have hidden the real board, so retry later instead of sending the candidate to manual review.
  if (firstError !== null) return { status: "error", error: firstError, ...(onlyRateLimits ? { rateLimited: true } : {}) };
  if (unproven.length > 0) return { status: "ambiguous", matches: unproven };
  return { status: "not_found" };
}
