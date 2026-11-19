import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { SENIORITY_LEVELS } from "./seniority";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const nonEmptyStrings = z.array(z.string().trim().min(1));

/** Hard rules from config/preferences.json. Every rule is optional; a job with an unknown value always passes. */
export const PreferencesSchema = z
  .object({
    /** Allowed seniority levels, read from the job title. */
    seniority: z.array(z.enum(SENIORITY_LEVELS)).min(1).optional(),
    /** Minimum yearly salary per ISO 4217 currency. */
    salaryFloor: z.record(z.string().regex(/^[A-Z]{3}$/), z.number().positive()).optional(),
    excludeDepartments: nonEmptyStrings.optional(),
    excludeTitleKeywords: nonEmptyStrings.optional(),
  })
  .strict();
export type Preferences = z.infer<typeof PreferencesSchema>;

function readIfExists(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** The search description, trimmed. */
export function loadSearchDescription(configDir: string): string {
  const text = readIfExists(path.join(configDir, "search.md"));
  if (text === null) {
    throw new ConfigError("Missing config/search.md. Copy config/search.example.md to config/search.md and describe the job you want.");
  }
  if (text.trim() === "") throw new ConfigError("config/search.md is empty.");
  return text.trim();
}

/** The hard rules. A missing file means no rules. */
export function loadPreferences(configDir: string): { prefs: Preferences; found: boolean } {
  const text = readIfExists(path.join(configDir, "preferences.json"));
  if (text === null) return { prefs: {}, found: false };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`config/preferences.json is not valid JSON: ${(err as Error).message}`);
  }
  const parsed = PreferencesSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new ConfigError(`config/preferences.json: ${issue.path.join(".")}: ${issue.message}`);
  }
  return { prefs: parsed.data, found: true };
}
