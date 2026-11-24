import fs from "node:fs";
import path from "node:path";
import { ConfigError } from "./config-error";
import { JobFilterRulesSchema, type JobFilterRules } from "./job-filter-rules";

const USER_FILE = "job-filter-rules.json";
const EXAMPLE_FILE = "job-filter-rules.example.json";

function readIfExists(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** The user's job filter rules, or the committed example's when the user has none. */
export function loadJobFilterRules(configDir: string): { rules: JobFilterRules; fromExample: boolean } {
  let name = USER_FILE;
  let text = readIfExists(path.join(configDir, USER_FILE));
  if (text === null) {
    name = EXAMPLE_FILE;
    text = readIfExists(path.join(configDir, EXAMPLE_FILE));
  }
  if (text === null) throw new ConfigError(`Missing config/${USER_FILE} and config/${EXAMPLE_FILE}.`);

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`config/${name} is not valid JSON: ${(err as Error).message}`);
  }
  const parsed = JobFilterRulesSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const where = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    throw new ConfigError(`config/${name}: ${where}: ${issue.message}`);
  }
  return { rules: parsed.data, fromExample: name === EXAMPLE_FILE };
}
