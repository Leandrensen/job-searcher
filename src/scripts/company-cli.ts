import { boardUrl, normalizeSlug } from "@/companies/slugs";
import type { ProbeFn, ProbeResult } from "@/companies/types";
import type { HttpClient } from "@/core/http";
import { ATS_IDS, type AtsId } from "@/core/job";
import type { Db } from "@/db/client";
import {
  addManualCompany,
  findCandidateByName,
  getCandidate,
  listActiveCompanies,
  listAmbiguousCandidates,
  recordResolution,
  rejectCandidate,
  upsertCandidate,
} from "@/db/companies";
import { CliUsageError } from "./fetch-cli";

const USAGE =
  "Usage: company add <ats> <slug> [--name <name>] [--country <ISO2>] | review | confirm <candidateId> <ats> <slug> | reject <candidateId> | sample <n>";

export interface CompanyCliDeps {
  /** Called only after the arguments are valid. */
  openDb: () => Db;
  http: HttpClient;
  probes: Record<AtsId, ProbeFn>;
  now?: () => Date;
  /** For `sample`. Defaults to Math.random. */
  random?: () => number;
  out: {
    log(msg: string): void;
    error(msg: string): void;
    table(rows: Array<Record<string, string | number>>): void;
  };
}

type Command =
  | { kind: "add"; ats: AtsId; slug: string; name: string | null; country: string | null }
  | { kind: "review" }
  | { kind: "confirm"; candidateId: number; ats: AtsId; slug: string }
  | { kind: "reject"; candidateId: number }
  | { kind: "sample"; n: number };

function parseAts(value: string | undefined): AtsId {
  if (!value || !(ATS_IDS as readonly string[]).includes(value)) {
    throw new CliUsageError(`Unknown ATS: ${value ?? ""}. Valid: ${ATS_IDS.join(", ")}`);
  }
  return value as AtsId;
}

function parsePositiveInt(value: string | undefined): number {
  const n = Number(value);
  if (!value || !Number.isInteger(n) || n < 1) throw new CliUsageError(USAGE);
  return n;
}

function parseCommand(argv: string[]): Command {
  const [sub, ...rest] = argv;
  switch (sub) {
    case "add": {
      const positional: string[] = [];
      let name: string | null = null;
      let country: string | null = null;
      for (let i = 0; i < rest.length; i++) {
        const arg = rest[i]!;
        if (arg === "--name") name = rest[++i] ?? null;
        else if (arg === "--country") country = rest[++i] ?? null;
        else if (arg.startsWith("--")) throw new CliUsageError(`Unknown option: ${arg}`);
        else positional.push(arg);
      }
      if (positional.length !== 2) throw new CliUsageError(USAGE);
      const ats = parseAts(positional[0]);
      const slug = normalizeSlug(ats, positional[1]!);
      if (slug === "") throw new CliUsageError(USAGE);
      if (country !== null && !/^[A-Z]{2}$/.test(country)) {
        throw new CliUsageError(`Invalid --country: ${country} (use a 2-letter ISO code like US)`);
      }
      return { kind: "add", ats, slug, name, country };
    }
    case "review":
      if (rest.length > 0) throw new CliUsageError(USAGE);
      return { kind: "review" };
    case "confirm":
      if (rest.length !== 3) throw new CliUsageError(USAGE);
      {
        const ats = parseAts(rest[1]);
        const slug = normalizeSlug(ats, rest[2]!);
        if (slug === "") throw new CliUsageError(USAGE);
        return { kind: "confirm", candidateId: parsePositiveInt(rest[0]), ats, slug };
      }
    case "reject":
      if (rest.length !== 1) throw new CliUsageError(USAGE);
      return { kind: "reject", candidateId: parsePositiveInt(rest[0]) };
    case "sample":
      if (rest.length !== 1) throw new CliUsageError(USAGE);
      return { kind: "sample", n: parsePositiveInt(rest[0]) };
    default:
      throw new CliUsageError(USAGE);
  }
}

/** Runs a `company` subcommand and returns the process exit code. */
export async function runCompanyCli(argv: string[], deps: CompanyCliDeps): Promise<number> {
  const { out } = deps;
  let cmd: Command;
  try {
    cmd = parseCommand(argv);
  } catch (err) {
    if (err instanceof CliUsageError) {
      out.error(err.message);
      return 1;
    }
    throw err;
  }

  const db = deps.openDb();
  const nowIso = (deps.now ?? (() => new Date()))().toISOString();

  async function probe(ats: AtsId, slug: string): Promise<ProbeResult | null> {
    try {
      const result = await deps.probes[ats](deps.http, slug);
      if (result.exists) return result;
      out.error(`No ${ats} board found for ${slug}`);
    } catch (err) {
      out.error(`Could not check ${ats} board ${slug}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  }

  switch (cmd.kind) {
    case "add": {
      const found = await probe(cmd.ats, cmd.slug);
      if (!found) return 1;
      const { name } = addManualCompany(
        db,
        { ats: cmd.ats, slug: cmd.slug, name: cmd.name ?? found.companyName, homeCountry: cmd.country },
        nowIso,
      );
      // Link a candidate to the company, so the seed lists and boards don't look it up again.
      upsertCandidate(db, { name, homeCountry: cmd.country, atsHints: [boardUrl(cmd)], origin: "manual" }, nowIso);
      const candidate = findCandidateByName(db, name);
      if (candidate) recordResolution(db, candidate.id, { status: "confirmed", ats: cmd.ats, slug: cmd.slug, companyName: found.companyName }, nowIso);
      out.log(`Added ${cmd.ats}/${cmd.slug} (${name})`);
      return 0;
    }

    case "review": {
      const rows = listAmbiguousCandidates(db);
      if (rows.length === 0) {
        out.log("No ambiguous companies.");
        return 0;
      }
      out.table(
        rows.map((c) => ({
          id: c.id,
          name: c.name,
          origin: c.origin,
          website: c.website ?? "",
          matches: c.ambiguousMatches.map((m) => `${m.ats}/${m.slug}`).join(", "),
        })),
      );
      return 0;
    }

    case "confirm": {
      const candidate = getCandidate(db, cmd.candidateId);
      if (!candidate) {
        out.error(`No candidate with id ${cmd.candidateId}`);
        return 1;
      }
      if (candidate.status !== "ambiguous") {
        out.error(`Candidate ${cmd.candidateId} is not ambiguous`);
        return 1;
      }
      const found = await probe(cmd.ats, cmd.slug);
      if (!found) return 1;
      recordResolution(db, candidate.id, { status: "confirmed", ats: cmd.ats, slug: cmd.slug, companyName: found.companyName }, nowIso);
      out.log(`Confirmed ${candidate.name} → ${cmd.ats}/${cmd.slug}`);
      return 0;
    }

    case "reject": {
      const candidate = getCandidate(db, cmd.candidateId);
      if (!candidate) {
        out.error(`No candidate with id ${cmd.candidateId}`);
        return 1;
      }
      if (candidate.status !== "ambiguous") {
        out.error(`Candidate ${cmd.candidateId} is not ambiguous`);
        return 1;
      }
      rejectCandidate(db, candidate.id, nowIso);
      out.log(`Rejected ${candidate.name}`);
      return 0;
    }

    case "sample": {
      const all = listActiveCompanies(db);
      if (all.length === 0) {
        out.log("No active companies.");
        return 0;
      }
      const random = deps.random ?? Math.random;
      // Fisher-Yates shuffle, then take the first n.
      const shuffled = [...all];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      for (const c of shuffled.slice(0, cmd.n)) {
        out.log(`${c.name} | ${c.ats} | ${c.slug} | ${boardUrl({ ats: c.ats, slug: c.slug })}`);
      }
      return 0;
    }
  }
}
