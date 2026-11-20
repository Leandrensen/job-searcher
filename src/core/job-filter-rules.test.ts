import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { checkJobRules, JobFilterRulesSchema, matchesKeywords, type JobFilterRules, type RuleInput } from "./job-filter-rules";

const EXAMPLE = JSON.parse(fs.readFileSync("config/job-filter-rules.example.json", "utf8"));
const KEYWORDS: string[] = EXAMPLE.keywords;
const job = (title: string, departments: string[] = [], tags: string[] = []) => ({ title, departments, tags });

describe("matchesKeywords", () => {
  describe("matches tech roles", () => {
    it.each([
      "Senior Full-Stack Engineer",
      "Frontend Engineer",
      "Back-End Developer",
      "Software Engineer",
      "Senior Software Developer",
      "Web Developer",
      "UI Engineer",
      "Product Engineer",
      "React Native Developer", // accepted false positive: mobile
      "Node.js Developer",
      "TypeScript Engineer",
      "Next.js Developer",
      "Martech Engineer",
      "Marketing Technology Manager",
      "Snowflake Data Engineer",
      "AWS Cloud Engineer",
    ])("%s", (title) => {
      expect(matchesKeywords(job(title), KEYWORDS)).toBe(true);
    });

    it("matches via department or tags", () => {
      expect(matchesKeywords(job("Rockstar", ["Frontend"]), KEYWORDS)).toBe(true);
      expect(matchesKeywords(job("Rockstar", [], ["full stack programming"]), KEYWORDS)).toBe(true);
    });
  });

  describe("rejects other roles", () => {
    it.each([
      "Account Executive",
      "Sales Engineer",
      "Data Scientist",
      "DevOps Engineer",
      "Site Reliability Engineer",
      "Security Guard",
      "Registered Nurse",
      "Customer Success Manager",
      "Product Manager",
      "Next Generation Sales Lead", // "next" alone is not a keyword
      "Engineer",
    ])("%s", (title) => {
      expect(matchesKeywords(job(title), KEYWORDS)).toBe(false);
    });
  });

  it("never reads descriptions", () => {
    expect(matchesKeywords({ ...job("Account Executive"), descriptionText: "We use React and Node" } as never, KEYWORDS)).toBe(false);
  });

  // KNOWN AND ACCEPTED: keywords on the title can match non-developer roles. Claude scoring (M4) handles these.
  it("accepts the known false positive 'Segment Marketing Manager'", () => {
    expect(matchesKeywords(job("Segment Marketing Manager"), KEYWORDS)).toBe(true);
  });

  it.each(KEYWORDS)("every example keyword matches itself: %s", (keyword) => {
    expect(matchesKeywords(job(keyword), KEYWORDS)).toBe(true);
  });

  it("a hyphenated keyword matches", () => {
    expect(matchesKeywords({ title: "Full Stack Dev", departments: [], tags: [] }, ["full-stack"])).toBe(true);
  });

  it.each(["Qualitäts-Manager", "Universitäts-Klinikum Pflegekraft"])("an accented letter is part of the word: %s", (title) => {
    expect(matchesKeywords(job(title), KEYWORDS)).toBe(false);
  });

  it.each(["Développeur Front-End", "Desarrollador Frontend Sénior", "Ingeniería de Software · Node.js"])(
    "a keyword next to accented words still matches: %s",
    (title) => {
      expect(matchesKeywords(job(title), KEYWORDS)).toBe(true);
    },
  );

  it("a keyword glued to CJK letters does not match", () => {
    expect(matchesKeywords(job("JS開発者"), ["js"])).toBe(false);
  });
});

describe("checkJobRules", () => {
  const base: RuleInput = {
    title: "Senior React Developer",
    departments: ["Engineering"],
    tags: [],
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
  };
  const PASS = { pass: true } as const;
  const usd = (salaryMax: number, salaryPeriod: string | null, salaryMin: number | null = null) => ({ salaryMax, salaryMin, salaryCurrency: "USD", salaryPeriod });
  const floor = { keywords: ["react"], salaryFloor: { USD: 60000 } };

  it.each<[string, Partial<RuleInput>, JobFilterRules, ReturnType<typeof checkJobRules>]>([
    ["all rules pass", {}, { keywords: ["react"] }, PASS],
    ["no keyword matches", { title: "Senior Accountant" }, { keywords: ["react"] }, { pass: false, reason: "keywords" }],
    ["an excluded title keyword", {}, { keywords: ["react"], excludeTitleKeywords: ["React"] }, { pass: false, reason: "title" }],
    ["an excluded department, case-insensitive", {}, { keywords: ["react"], excludeDepartments: ["engineering"] }, { pass: false, reason: "department" }],
    ["a seniority outside the list", {}, { keywords: ["react"], seniority: ["mid"] }, { pass: false, reason: "seniority" }],
    ["a seniority in the list", {}, { keywords: ["react"], seniority: ["senior"] }, PASS],
    ["an unknown seniority passes", { title: "React Developer" }, { keywords: ["react"], seniority: ["mid"] }, PASS],
    ["a yearly salary below the floor", usd(50000, "year"), floor, { pass: false, reason: "salary" }],
    ["a range reaching the floor", usd(70000, "year", 50000), floor, PASS],
    ["a monthly salary is annualized (72,000)", usd(6000, "month"), floor, PASS],
    ["an hourly salary is annualized (52,000)", usd(25, "hour"), floor, { pass: false, reason: "salary" }],
    ["a currency without a floor passes", { salaryMax: 100, salaryCurrency: "EUR", salaryPeriod: "year" }, floor, PASS],
    ["an unknown period skips the salary rule", usd(59999, null), floor, PASS],
    ["an unrecognized period skips the salary rule", usd(1000, "week"), floor, PASS],
    ["a hyphenated title is excluded by a spaced phrase", { title: "Senior React Front-End Developer" }, { keywords: ["react"], excludeTitleKeywords: ["front end"] }, { pass: false, reason: "title" }],
    ["a spaced title is excluded by a hyphenated phrase", { title: "Senior React Data Scientist" }, { keywords: ["react"], excludeTitleKeywords: ["Data-Scientist"] }, { pass: false, reason: "title" }],
    ["an underscored department is excluded", { departments: ["Customer_Success"] }, { keywords: ["react"], excludeDepartments: ["Customer Success"] }, { pass: false, reason: "department" }],
    ["an exclusion inside another word doesn't match", { title: "Senior Reactive React Developer" }, { keywords: ["react"], excludeTitleKeywords: ["React Dev"] }, PASS],
    ["the first failing rule is reported", { title: "Senior Accountant", ...usd(1, "year") }, floor, { pass: false, reason: "keywords" }],
  ])("%s", (_label, over, rules, expected) => {
    expect(checkJobRules({ ...base, ...over }, rules)).toEqual(expected);
  });
});

describe("the example file", () => {
  it("is valid", () => {
    expect(JobFilterRulesSchema.safeParse(EXAMPLE).success).toBe(true);
  });

  const martech = { title: "Senior Martech Engineer", departments: ["Marketing"], tags: [], salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null };

  it("keeps a Martech Engineer in a Marketing department", () => {
    expect(checkJobRules(martech, EXAMPLE)).toEqual({ pass: true });
  });

  it("still drops a Sales department", () => {
    expect(checkJobRules({ ...martech, departments: ["Sales"] }, EXAMPLE)).toEqual({ pass: false, reason: "department" });
  });
});
