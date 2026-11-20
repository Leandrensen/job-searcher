import type { Db } from "@/db/client";
import { listOpenJobsForRanking } from "@/db/ranking";
import { ConfigError } from "@/core/config-error";
import { loadPreferences, loadSearchDescription } from "@/ranking/config";
import { embedJobs } from "@/ranking/embed-jobs";
import type { Embedder } from "@/ranking/embedder";
import { applyHardRules, rankJobs } from "@/ranking/rank";
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
  /** Called only after the config is valid. */
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
  let prefs;
  try {
    const configDir = deps.configDir ?? "config";
    search = loadSearchDescription(configDir);
    const loaded = loadPreferences(configDir);
    prefs = loaded.prefs;
    if (!loaded.found) out.log("No config/preferences.json: no hard rules applied");
  } catch (err) {
    if (err instanceof ConfigError) {
      out.error(err.message);
      return 1;
    }
    throw err;
  }

  const db = deps.openDb();
  const jobs = listOpenJobsForRanking(db);
  if (jobs.length === 0) {
    out.log("No open jobs to rank. Run npm run fetch first.");
    return 0;
  }

  const { kept, excluded } = applyHardRules(jobs, prefs);
  out.log(
    `Open jobs: ${jobs.length}, after hard rules: ${kept.length} (excluded: title ${excluded.title}, department ${excluded.department}, seniority ${excluded.seniority}, salary ${excluded.salary})`,
  );

  let ranked;
  try {
    const embedder = await deps.createEmbedder();
    // The search is one text, so it is embedded on every run and always matches the current search.md.
    const searchVector = (await embedder.embed([search]))[0]!;
    const { vectors, embedded, reused } = await embedJobs(db, embedder, kept, {
      nowIso: (deps.now ?? (() => new Date()))().toISOString(),
      log: out.log,
    });
    out.log(`Embedded ${embedded} new or changed jobs, reused ${reused}`);
    ranked = rankJobs(kept, vectors, searchVector, top);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    out.error(`Embedding failed: ${e.name}: ${e.message}`);
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
  out.log(`Showing ${ranked.length} of ${kept.length}`);
  return 0;
}
