import { normalizeCompany } from "@/core/dedupe";
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
    if (onDomain || probe.texts.some((t) => t.toLowerCase().includes(domain))) return true;
  }

  // 3. Lever and Ashby return no company name: the name must appear in at least 2 postings (or in the only one).
  if ((ats === "lever" || ats === "ashby") && probe.texts.length >= 1 && candidate.name.trim() !== "") {
    const nameRe = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(candidate.name.trim())}(?![\\p{L}\\p{N}])`, "iu");
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

  if (unproven.length > 0) return { status: "ambiguous", matches: unproven };
  if (firstError !== null) return { status: "error", error: firstError };
  return { status: "not_found" };
}
