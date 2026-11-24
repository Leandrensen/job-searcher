import type { Db } from "@/db/client";
import { listOpenJobsForRanking } from "@/db/ranking";
import { ConfigError } from "@/core/config-error";
import type { JobFilterRules } from "@/core/job-filter-rules";
import { loadJobFilterRules } from "@/core/job-filter-rules-file";
import { loadSearchDescription } from "@/ranking/config";
import { embedJobs } from "@/ranking/embed-jobs";
import type { Embedder } from "@/ranking/embedder";
import { filterByRules, rankJobs } from "@/ranking/rank";
import { CliUsageError } from "./cli-errors";

const DEFAULT_TOP = 100;

export function parseRankArgs(argv: string[]): { top: number } {
  let top = DEFAULT_TOP;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--top") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1) throw new CliUsageError("Missing or invalid value for --top");
      top = n;
    } else {
      throw new CliUsageError(`Unknown option: ${arg}`);
    }
  }
  return { top };
}

export interface RankCliDeps {
  /** Called only after search.md is valid. */
  openDb: () => Db;
  /** Called only when there are jobs to rank, because loading the model is slow. */
  createEmbedder: () => Promise<Embedder>;
  /** Default "config". */
  configDir?: string;
  now?: () => Date;
  out: {
    log(msg: string): void;
    error(msg: string): void;
    table(rows: Array<Record<string, string | number>>): void;
  };
}

/** Runs the rank command and returns the process exit code. */
export async function runRankCli(argv: string[], deps: RankCliDeps): Promise<number> {
  const { out } = deps;

  let top: number;
  try {
    ({ top } = parseRankArgs(argv));
  } catch (err) {
    if (err instanceof CliUsageError) {
      out.error(err.message);
      return 1;
    }
    throw err;
  }

  let search: string;
  let rules: JobFilterRules;
  try {
    search = loadSearchDescription(deps.configDir ?? "config");
    const loaded = loadJobFilterRules(deps.configDir ?? "config");
    rules = loaded.rules;
    if (loaded.fromExample) out.log("No config/job-filter-rules.json: using config/job-filter-rules.example.json");
  } catch (err) {
    if (err instanceof ConfigError) {
      out.error(err.message);
      return 1;
    }
    throw err;
  }

  // Rules can change after a fetch, so re-check them: a job that no longer passes is skipped here and closed by the next fetch.
  const db = deps.openDb();
  const { passing: jobs, skipped } = filterByRules(listOpenJobsForRanking(db), rules);
  if (skipped > 0) out.log(`Skipped by the current job filter rules: ${skipped}`);
  if (jobs.length === 0) {
    out.log("No open jobs to rank. Run npm run fetch first.");
    return 0;
  }
  out.log(`Open jobs: ${jobs.length}`);

  const errorText = (err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    return `${e.name}: ${e.message}`;
  };

  let embedder: Embedder;
  let searchVector: Float32Array;
  try {
    embedder = await deps.createEmbedder();
    // The search is one text, so it is embedded on every run and always matches the current search.md.
    searchVector = (await embedder.embed([search]))[0]!;
  } catch (err) {
    out.error(`Could not load the embedding model: ${errorText(err)}`);
    return 1;
  }

  let ranked;
  try {
    const { vectors, embedded, reused } = await embedJobs(db, embedder, jobs, {
      nowIso: (deps.now ?? (() => new Date()))().toISOString(),
      log: out.log,
    });
    out.log(`Embedded ${embedded} new or changed jobs, reused ${reused}`);
    ranked = rankJobs(jobs, vectors, searchVector, top);
  } catch (err) {
    out.error(`Ranking failed: ${errorText(err)}`);
    return 1;
  }

  out.table(
    ranked.map((r, i) => ({
      rank: i + 1,
      similarity: Math.round(r.similarity * 1000) / 1000,
      title: r.job.title,
      company: r.job.company,
      location: r.job.location ?? "",
      url: r.job.url,
    })),
  );
  out.log(`Showing ${ranked.length} of ${jobs.length}`);
  return 0;
}
