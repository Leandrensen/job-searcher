export const SENIORITY_LEVELS = ["intern", "junior", "mid", "senior", "staff", "principal", "lead", "manager"] as const;
export type SeniorityLevel = (typeof SENIORITY_LEVELS)[number];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalize = (s: string) => s.toLowerCase().replace(/[-_/]/g, " ").replace(/\s+/g, " ");

// Checked in this order: the first level whose words appear in the title wins, so a title naming several levels gets the
// highest ("Senior Engineering Manager" is a manager, "Sr/SSr" is senior). A level word right after "semi " doesn't count,
// so "Semi Senior" is mid.
const RULES: readonly { level: SeniorityLevel; words: string[] }[] = [
  { level: "manager", words: ["manager", "head of", "director", "vp", "vice president", "cto"] },
  { level: "principal", words: ["principal", "distinguished"] },
  { level: "staff", words: ["staff"] },
  { level: "lead", words: ["lead"] },
  { level: "senior", words: ["senior", "sr", "sr."] },
  {
    level: "mid",
    words: ["semi senior", "semi-senior", "semisenior", "semi sr", "ssr", "mid", "mid level", "intermediate"],
  },
  { level: "junior", words: ["junior", "jr", "jr.", "entry level", "graduate", "associate"] },
  { level: "intern", words: ["intern", "internship", "trainee", "apprentice"] },
];

const PATTERNS = RULES.map((r) => ({
  level: r.level,
  re: new RegExp(`(?<![a-z0-9])(?<!semi )(?:${r.words.map((w) => escapeRegExp(normalize(w))).join("|")})(?![a-z0-9])`),
}));

/** The seniority level a job title states, or null when it states none. */
export function deriveSeniority(title: string): SeniorityLevel | null {
  const text = normalize(title);
  return PATTERNS.find((p) => p.re.test(text))?.level ?? null;
}
