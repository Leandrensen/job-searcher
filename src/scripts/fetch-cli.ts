import type { HttpClient } from "@/core/http";
import type { Db } from "@/db/client";
import { countJobs } from "@/db/queries";
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
}

export function parseFetchArgs(argv: string[]): FetchArgs {
  const sources: string[] = [];
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--force") {
      force = true;
    } else if (arg === "--source") {
      const value = argv[++i];
      const parts = value && !value.startsWith("--") ? value.split(",").filter(Boolean) : [];
      if (parts.length === 0) throw new CliUsageError("Missing value for --source");
      for (const part of parts) if (!sources.includes(part)) sources.push(part);
    } else {
      throw new CliUsageError(`Unknown option: ${arg}`);
    }
  }
  return { sources, force };
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

export interface CliDeps {
  /** Called only after the arguments are valid. */
  openDb: () => Db;
  http: HttpClient;
  adapters: AnyAdapter[];
  now?: () => Date;
  out: {
    log(msg: string): void;
    error(msg: string): void;
    table(rows: SummaryRow[]): void;
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

  const valid = deps.adapters.map((a) => a.id as string);
  const unknown = args.sources.find((id) => !valid.includes(id));
  if (unknown !== undefined) {
    out.error(`Unknown source: ${unknown}. Valid: ${valid.join(", ")}`);
    return 1;
  }
  // Registry order, not argument order.
  const selected = args.sources.length ? deps.adapters.filter((a) => args.sources.includes(a.id)) : deps.adapters;

  const db = deps.openDb();
  const results = await runSources({
    db,
    http: deps.http,
    adapters: selected,
    force: args.force,
    now: deps.now,
    log: out.log,
  });

  out.table(
    results.map((r) => ({
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
  out.log(`Total jobs in DB: ${countJobs(db)}`);
  return results.some((r) => r.status === "success" || r.status === "skipped") ? 0 : 1;
}
