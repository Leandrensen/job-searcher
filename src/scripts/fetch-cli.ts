import { resolveDueCandidates } from "@/companies/resolve-runner";
import type { ProbeFn } from "@/companies/types";
import type { HttpClient } from "@/core/http";
import type { AtsId } from "@/core/job";
import { createPacedHttpClient, type PacingOptions } from "@/core/paced-http";
import type { Db } from "@/db/client";
import { companyCounts } from "@/db/companies";
import { countJobs, purgeClosedJobs } from "@/db/queries";
import { runAtsSources } from "@/sources/ats-runner";
import { runSources } from "@/sources/runner";
import type { AnyAdapter } from "@/sources/types";

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export interface FetchArgs {
  sources: string[];
  force: boolean;
  skipResolve: boolean;
}

export function parseFetchArgs(argv: string[]): FetchArgs {
  const sources: string[] = [];
  let force = false;
  let skipResolve = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--force") {
      force = true;
    } else if (arg === "--skip-resolve") {
      skipResolve = true;
    } else if (arg === "--source") {
      const value = argv[++i];
      const parts = value && !value.startsWith("--") ? value.split(",").filter(Boolean) : [];
      if (parts.length === 0) throw new CliUsageError("Missing value for --source");
      for (const part of parts) if (!sources.includes(part)) sources.push(part);
    } else {
      throw new CliUsageError(`Unknown option: ${arg}`);
    }
  }
  return { sources, force, skipResolve };
}

export interface SummaryRow {
  source: string;
  status: string;
  fetched: number;
  inserted: number;
  updated: number;
  invalid: number;
  filtered: number;
  ms: number;
  error: string;
}

export interface AtsSummaryRow {
  source: string;
  status: string;
  companies: number;
  failed: number;
  fetched: number;
  inserted: number;
  updated: number;
  invalid: number;
  filteredTech: number;
  filteredLocation: number;
  closed: number;
  ms: number;
  error: string;
}

export interface CliDeps {
  /** Called only after the arguments are valid. */
  openDb: () => Db;
  http: HttpClient;
  boardAdapters: AnyAdapter[];
  atsAdapters: AnyAdapter[];
  probes: Record<AtsId, ProbeFn>;
  /** Max candidates resolved per fetch run. Default 50. */
  resolveLimit?: number;
  now?: () => Date;
  /** Default: 500 ms between requests to a host. Tests turn pacing off. */
  pacing?: PacingOptions;
  out: {
    log(msg: string): void;
    error(msg: string): void;
    table(rows: SummaryRow[] | AtsSummaryRow[]): void;
  };
}

/** Runs the fetch command and returns the process exit code. */
export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const { out } = deps;

  let args: FetchArgs;
  try {
    args = parseFetchArgs(argv);
  } catch (err) {
    if (err instanceof CliUsageError) {
      out.error(err.message);
      return 1;
    }
    throw err;
  }

  const all = [...deps.boardAdapters, ...deps.atsAdapters];
  const valid = all.map((a) => a.id as string);
  const unknown = args.sources.find((id) => !valid.includes(id));
  if (unknown !== undefined) {
    out.error(`Unknown source: ${unknown}. Valid: ${valid.join(", ")}`);
    return 1;
  }
  // Registry order, not argument order.
  const pick = (list: AnyAdapter[]) => (args.sources.length ? list.filter((a) => args.sources.includes(a.id)) : list);
  const boards = pick(deps.boardAdapters);
  const atsList = pick(deps.atsAdapters);

  const db = deps.openDb();
  const now = deps.now ?? (() => new Date());
  const paced = createPacedHttpClient(deps.http, deps.pacing);

  // 1. Boards only discover companies. They are single endpoints with their own intervals, so no pacing.
  const boardResults = boards.length
    ? await runSources({ db, http: deps.http, adapters: boards, force: args.force, now, log: out.log })
    : [];
  if (boardResults.length) {
    out.table(
      boardResults.map((r) => ({
        source: r.source,
        status: r.status,
        fetched: r.fetched,
        inserted: r.inserted,
        updated: r.updated,
        invalid: r.invalid,
        filtered: r.filtered,
        ms: r.durationMs,
        error: r.error ?? "",
      })),
    );
  }

  // 2. Resolve newly discovered candidates to ATS boards.
  if (args.skipResolve || args.sources.length > 0) {
    out.log("Resolution: skipped");
  } else {
    const s = await resolveDueCandidates({ db, http: paced, probes: deps.probes, now, limit: deps.resolveLimit ?? 50, log: out.log });
    out.log(`Resolution: checked ${s.checked}, confirmed ${s.confirmed}, ambiguous ${s.ambiguous}, not found ${s.notFound}, errors ${s.errors}`);
  }

  // 3. Fetch the jobs of every due company.
  const atsResults = await runAtsSources({ db, http: paced, adapters: atsList, force: args.force, now, log: out.log });
  out.table(
    atsResults.map((r) => ({
      source: r.source,
      status: r.status,
      companies: r.companies,
      failed: r.companiesFailed,
      fetched: r.fetched,
      inserted: r.inserted,
      updated: r.updated,
      invalid: r.invalid,
      filteredTech: r.filteredTech,
      filteredLocation: r.filteredLocation,
      closed: r.closed,
      ms: r.durationMs,
      error: r.error ?? "",
    })),
  );

  // 4. Forget jobs that have been closed for a month.
  out.log(`Purged ${purgeClosedJobs(db, now().toISOString())} closed jobs`);
  out.log(`Open jobs in DB: ${countJobs(db, { openOnly: true })}`);
  out.log(`Active companies: ${companyCounts(db).active}`);
  return [...boardResults, ...atsResults].some((r) => r.status === "success" || r.status === "skipped") ? 0 : 1;
}
