import fs from "node:fs";
import { JobFilterRulesSchema, type JobFilterRules } from "@/core/job-filter-rules";

/** The committed example rules (config/job-filter-rules.example.json). Never the user's personal file. */
export function exampleRules(): JobFilterRules {
  return JobFilterRulesSchema.parse(JSON.parse(fs.readFileSync("config/job-filter-rules.example.json", "utf8")));
}

/** Only the example's keywords: use this unless a test is about the other rules. */
export function keywordRules(): JobFilterRules {
  return { keywords: exampleRules().keywords };
}
