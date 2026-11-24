export const SENIORITY_LEVELS = ["intern", "junior", "mid", "senior", "staff", "principal", "lead", "manager"] as const;
export type SeniorityLevel = (typeof SENIORITY_LEVELS)[number];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Checked in this order: the first level whose words appear in the title wins ("Senior Engineering Manager" is a manager).
const RULES: readonly { level: SeniorityLevel; words: string[] }[] = [
  { level: "manager", words: ["manager", "head of", "director", "vp", "vice president", "cto"] },
  { level: "principal", words: ["principal", "distinguished"] },
  { level: "staff", words: ["staff"] },
  { level: "lead", words: ["lead"] },
  // Before "senior", which would otherwise win on "Semi Senior".
  { level: "mid", words: ["semi senior", "semi sr", "semi sr.", "semisenior"] },
  { level: "senior", words: ["senior", "sr", "sr."] },
  { level: "mid", words: ["semi", "semi senior", "mid", "mid level", "intermediate"] },
  { level: "junior", words: ["junior", "jr", "jr.", "entry level", "graduate", "associate"] },
  { level: "intern", words: ["intern", "internship", "trainee", "apprentice"] },
];

const PATTERNS = RULES.map((r) => ({
  level: r.level,
  re: new RegExp(`(?<![a-z0-9])(?:${r.words.map(escapeRegExp).join("|")})(?![a-z0-9])`),
}));

/** The seniority level a job title states, or null when it states none. */
export function deriveSeniority(title: string): SeniorityLevel | null {
  const text = title.toLowerCase().replace(/[-_/]/g, " ").replace(/\s+/g, " ");
  return PATTERNS.find((p) => p.re.test(text))?.level ?? null;
}
