import { createHttpClient } from "@/core/http";
import { openDb } from "@/db/client";
import { atsAdapters, atsProbes, boardAdapters } from "@/sources/registry";
import { runCli } from "./fetch-cli";

// Process wiring only. The logic lives in fetch-cli.ts, which is unit tested.
runCli(process.argv.slice(2), {
  openDb: () => openDb({ migrate: true }),
  http: createHttpClient(),
  boardAdapters,
  atsAdapters,
  probes: atsProbes,
  out: { log: console.log, error: console.error, table: (rows) => console.table(rows) },
}).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
