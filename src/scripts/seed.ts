import { createHttpClient } from "@/core/http";
import { openDb } from "@/db/client";
import { atsProbes } from "@/sources/registry";
import { runSeedCli } from "./seed-cli";

// Process wiring only. The logic lives in seed-cli.ts, which is unit tested.
runSeedCli(process.argv.slice(2), {
  openDb: () => openDb({ migrate: true }),
  http: createHttpClient(),
  probes: atsProbes,
  out: { log: console.log, error: console.error, table: (rows) => console.table(rows) },
}).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
