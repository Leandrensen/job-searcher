import { resolveDueCandidates } from "@/companies/resolve-runner";
import { fetchRemoteintechCandidates, fetchYcCandidates } from "@/companies/seeds";
import type { ProbeFn } from "@/companies/types";
import type { HttpClient } from "@/core/http";
import type { AtsId } from "@/core/job";
import { createPacedHttpClient, DEFAULT_PACING, type PacingOptions } from "@/core/paced-http";
import type { Db } from "@/db/client";
import { type CandidateInput, companyCounts, upsertCandidate } from "@/db/companies";
import { CliUsageError } from "./fetch-cli";

export interface SeedArgs {
  limit: number | undefined;
  resolve: boolean;
  only: "remoteintech" | "yc" | undefined;
}

export function parseSeedArgs(argv: string[]): SeedArgs {
  const args: SeedArgs = { limit: undefined, resolve: true, only: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--no-resolve") {
      args.resolve = false;
    } else if (arg === "--limit") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1) throw new CliUsageError("Missing or invalid value for --limit");
      args.limit = n;
    } else if (arg === "--only") {
      const value = argv[++i];
      if (value !== "remoteintech" && value !== "yc") {
        throw new CliUsageError("Missing or invalid value for --only (remoteintech or yc)");
      }
      args.only = value;
    } else {
      throw new CliUsageError(`Unknown option: ${arg}`);
    }
  }
  return args;
}

export interface SeedCliDeps {
  /** Called only after the arguments are valid. */
  openDb: () => Db;
  http: HttpClient;
  probes: Record<AtsId, ProbeFn>;
  now?: () => Date;
  /** Default: DEFAULT_PACING. Tests turn pacing off. */
  pacing?: PacingOptions;
  out: {
    log(msg: string): void;
    error(msg: string): void;
    table(rows: Array<Record<string, string | number>>): void;
  };
}

/** Runs the seed command and returns the process exit code. */
export async function runSeedCli(argv: string[], deps: SeedCliDeps): Promise<number> {
  const { out } = deps;
  let args: SeedArgs;
  try {
    args = parseSeedArgs(argv);
  } catch (err) {
    if (err instanceof CliUsageError) {
      out.error(err.message);
      return 1;
    }
    throw err;
  }

  const db = deps.openDb();
  const now = deps.now ?? (() => new Date());
  const http = createPacedHttpClient(deps.http, deps.pacing ?? DEFAULT_PACING);

  // 1. Load the seed lists. A failing source is reported and the other one still loads.
  let loaded = 0;
  const perOrigin = new Map<string, { inserted: number; updated: number; unchanged: number }>();
  const addCandidates = (origin: string, candidates: CandidateInput[]) => {
    const counts = perOrigin.get(origin) ?? { inserted: 0, updated: 0, unchanged: 0 };
    for (const c of candidates) counts[upsertCandidate(db, c, now().toISOString())]++;
    perOrigin.set(origin, counts);
  };

  if (args.only !== "yc") {
    try {
      addCandidates("seed:remoteintech", await fetchRemoteintechCandidates(http, out.log));
      loaded++;
    } catch (err) {
      out.error(`Seed source remoteintech failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (args.only !== "remoteintech") {
    try {
      const { kept, skipped } = await fetchYcCandidates(http);
      addCandidates("seed:yc", kept);
      out.log(`YC skipped: not active ${skipped.notActive}, not hiring ${skipped.notHiring}, home country ${skipped.homeCountry}`);
      loaded++;
    } catch (err) {
      out.error(`Seed source yc failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  out.table([...perOrigin].map(([origin, c]) => ({ origin, ...c })));

  // 2. Resolve candidates to ATS boards.
  if (args.resolve) {
    const stats = await resolveDueCandidates({ db, http, probes: deps.probes, now, limit: args.limit, log: out.log });
    out.table(
      Object.entries(stats.byOrigin).map(([origin, s]) => ({
        origin,
        checked: s.checked,
        confirmed: s.confirmed,
        rate: `${Math.round((s.confirmed / s.checked) * 100)}%`,
      })),
    );
  }

  const counts = companyCounts(db);
  const byAts = Object.entries(counts.byAts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ats, n]) => `${ats} ${n}`)
    .join(", ");
  out.log(`Companies: ${counts.active} active${byAts ? ` (${byAts})` : ""}`);
  return loaded > 0 ? 0 : 1;
}
