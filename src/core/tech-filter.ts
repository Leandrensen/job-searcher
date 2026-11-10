import type { Job } from "./job";

export const TECH_KEYWORDS: readonly string[] = [
  "developer", "engineer", "engineering", "software", "programmer", "programming",
  "devops", "sre", "sysadmin", "system administrator", "frontend", "front end",
  "backend", "back end", "full stack", "fullstack", "web", "mobile", "ios", "android",
  "data scientist", "data engineer", "data analyst", "machine learning", "ml", "ai", "qa",
  "test automation", "security", "cloud", "architect", "infrastructure", "platform",
  "database", "dba", "it support", "technical support", "tech lead", "cto",
];

const KEYWORD_PATTERNS = TECH_KEYWORDS.map((k) => new RegExp(`\\b${k}\\b`));

export function isTechJob(job: Pick<Job, "title" | "tags">): boolean {
  const haystack = `${job.title} ${job.tags.join(" ")}`.toLowerCase().replace(/-/g, " ");
  return KEYWORD_PATTERNS.some((re) => re.test(haystack));
}
