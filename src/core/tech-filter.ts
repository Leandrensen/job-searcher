import type { Job } from "./job";

/** Storage tech filter: matched on title, department/team and tags only, never on descriptions. */
export const TECH_KEYWORDS: readonly string[] = [
  "full stack", "fullstack", "front end", "frontend", "back end", "backend",
  "software engineer", "software developer", "web developer", "web engineer",
  "ui engineer", "ui developer", "product engineer",
  "javascript", "typescript", "js", "ts", "react", "react.js", "reactjs",
  "next.js", "nextjs", "node", "node.js", "nodejs",
  "martech", "marketing technology", "segment", "snowflake", "aws",
];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const KEYWORD_PATTERNS = TECH_KEYWORDS.map((k) => new RegExp(`(?<![a-z0-9])${escapeRegExp(k)}(?![a-z0-9])`));

export function isTechJob(job: Pick<Job, "title" | "departments" | "tags">): boolean {
  const haystack = [job.title, ...job.departments, ...job.tags]
    .join(" | ")
    .toLowerCase()
    .replace(/[-_/]/g, " ")
    .replace(/\s+/g, " ");
  return KEYWORD_PATTERNS.some((re) => re.test(haystack));
}
