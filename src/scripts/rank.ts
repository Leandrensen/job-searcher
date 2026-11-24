import { openDb } from "@/db/client";
import { createTransformersEmbedder } from "@/ranking/transformers-embedder";
import { runRankCli } from "./rank-cli";

// Process wiring only. The logic lives in rank-cli.ts, which is unit tested.
runRankCli(process.argv.slice(2), {
  openDb: () => openDb({ migrate: true }),
  createEmbedder: () => createTransformersEmbedder(),
  out: { log: console.log, error: console.error, table: (rows) => console.table(rows) },
}).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
