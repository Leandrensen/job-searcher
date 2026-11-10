import { createHttpClient } from "@/core/http";
import { openDb } from "@/db/client";
import { countJobs } from "@/db/queries";
import { adapters } from "@/sources/registry";
import { runSources } from "@/sources/runner";

function parseArgs(argv: string[]): { sources: string[]; force: boolean } {
  const sources: string[] = [];
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--force") {
      force = true;
    } else if (arg === "--source") {
      const value = argv[++i];
      if (!value) throw new Error("Missing value for --source");
      sources.push(...value.split(",").filter(Boolean));
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return { sources, force };
}

async function main(): Promise<number> {
  const valid = adapters.map((a) => a.id);
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return 1;
  }
  for (const id of args.sources) {
    if (!valid.includes(id as (typeof valid)[number])) {
      console.error(`Unknown source: ${id}. Valid: ${valid.join(", ")}`);
      return 1;
    }
  }
  const selected = args.sources.length ? adapters.filter((a) => args.sources.includes(a.id)) : adapters;

  const db = openDb({ migrate: true });
  const results = await runSources({
    db,
    http: createHttpClient(),
    adapters: selected,
    force: args.force,
    log: (msg) => console.log(msg),
  });

  console.table(
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
  console.log(`Total jobs in DB: ${countJobs(db)}`);
  return results.some((r) => r.status === "success" || r.status === "skipped") ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
