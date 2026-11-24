import fs from "node:fs";
import path from "node:path";
import { ConfigError } from "@/core/config-error";

function readIfExists(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** The search description (config/search.md), trimmed. Job filters live in config/job-filter-rules.json instead. */
export function loadSearchDescription(configDir: string): string {
  const text = readIfExists(path.join(configDir, "search.md"));
  if (text === null) {
    throw new ConfigError("Missing config/search.md. Copy config/search.example.md to config/search.md and describe the job you want.");
  }
  if (text.trim() === "") throw new ConfigError("config/search.md is empty.");
  return text.trim();
}
