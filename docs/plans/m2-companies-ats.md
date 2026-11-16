# M2: Companies + ATS sources

## Goal
`npm run seed` builds a company list from open seed lists and resolves each company to its ATS **precisely**. `npm run fetch` then:
1. discovers new companies from 7 job boards, whose jobs are **not stored**
2. resolves a batch of pending companies
3. fetches every active company's jobs from 6 ATSs (Greenhouse, Lever, Ashby, Workable, Recruitee, SmartRecruiters)
4. stores only jobs that pass the **tech filter** and the **location filter**
5. marks jobs that disappeared as closed, and deletes jobs closed for more than 30 days

## Context
- **Read first:** `CLAUDE.md` (all rules apply) and `PLAN.md`, especially Pipeline and M2. This spec turns M2 into tasks; when they disagree, this spec wins, and you report the mismatch.
- **Node 22:** run `nvm use` in every new shell.
- **Branch:** `feat/m2-companies-ats`, created from `main` (T0). Never commit to `main`.
- **Commits:** one per task, `<type>(m2): T<n> <summary>` (Conventional Commits). Tick that task's `[ ] Done` box in **this file** in the same commit.
- **TDD:** for every task with "Tests first", write the tests, run them and see them fail, then implement.
- **Mocking policy** (same as M1.1):
  - **Allowed:** fake HTTP clients that serve **recorded or hand-written fixtures** (`createFixtureHttp`), an injected `sleep`, and an injected clock.
  - **Not allowed:** `vi.mock`, or mocking anything in `src/db/*` or `src/core/*`. DB tests use `openDb({ url: ":memory:", migrate: true })`.
- **Approved interface changes** (PLAN.md decisions log, 2026-11-16). Make **only** these:
  1. `Job`:
     - `remote` is replaced by `workplaceType: "remote" | "hybrid" | "onsite" | null`
     - new fields `departments: string[]`, `regions: string[]` and `employmentType: string | null`
     - `externalId` for ATS jobs is `<slug>:<ATS job id>`
     - `SOURCE_IDS` gets the 6 ATS ids, and loses `getonboard` and `hn-hiring`
  2. `FetchContext` gets an **optional** `companies?: CompanyRef[]` (ATS adapters receive their companies).
  3. DB: `jobs.companyId`, `jobs.closedAt`, the new tables `companies` and `company_candidates`, and `companies.homeCountry`.
  4. Any other change to `Job` or `SourceAdapter` means **stop and ask**.
- **Facts verified on 2026-11-16 against live APIs.** Use these and don't re-derive them:
  - **Existence probes.** A 404 means "not there" for Greenhouse `/v1/boards/<slug>`, Lever `/v0/postings/<slug>`, Ashby `/posting-api/job-board/<slug>`, Workable `/api/v1/widget/accounts/<slug>` and Recruitee `https://<slug>.recruitee.com/api/offers/`. SmartRecruiters returns **200 with `totalFound: 0`** for unknown slugs.
  - **Company name fields:**
    - Greenhouse board `name`
    - Workable `name`
    - Recruitee offer `company_name`
    - SmartRecruiters posting `company.name`
    - Lever and Ashby have **no** company name field
  - **Real slugs with jobs** (use them for fixtures and live checks): Greenhouse `mozilla`, Lever `curai` (has `salaryRange`), Ashby `livekit` (has salary components), Workable `modash` (33 jobs), Recruitee `tether`, SmartRecruiters `BoschGroup` (case-sensitive).
  - **Ashby salary:** `compensation.compensationTiers[].components[]` with `compensationType: "Salary"`, `interval: "1 YEAR"`, `currencyCode`, `minValue`, `maxValue`. `workplaceType` takes values like `"Remote"` and `"Hybrid"`. `secondaryLocations` is `[{ location: "EMEA", ... }]`.
  - **Lever:** `salaryRange` is `{ min, max, currency, interval: "per-year-salary" }`, `createdAt` is **epoch milliseconds**, `workplaceType` is `"remote" | "hybrid" | "onsite" | "unspecified"`, and `categories` is `{ location, team, department?, commitment, allLocations[] }`.
  - **SmartRecruiters:** the detail endpoint `GET /v1/companies/<slug>/postings/<id>` has `postingUrl` (the human page) and `jobAd.sections.{companyDescription,jobDescription,qualifications,additionalInformation}.text`. The list endpoint has no description.
  - **Workable `?details=true`:** each job has `shortcode`, `title`, `url`, `application_url`, `published_on` (`YYYY-MM-DD`), `telecommuting` (boolean), `city`, `state`, `country`, `department`, `employment_type`, `locations[]` and `description`.
  - **YC dataset:** `https://yc-oss.github.io/api/companies/all.json` holds 6,399 companies. Fields used: `name`, `website`, `status`, `isHiring`, `all_locations` (e.g. `"San Francisco, CA, USA; New York, NY, USA"`). About 1,370 are kept after the seed filter.
  - **`remoteintech`:** about 878 files in `src/companies/*.md` with YAML front matter (`title`, `website`, `careers_url`, ...). List them with one GitHub tree request; read each file from `raw.githubusercontent.com`.
- **Decided refinements of PLAN.md.** Treat these as decided; don't change them:
  - **"Ambiguous"** means at least one ATS board exists for a guessed slug but identity couldn't be proven anywhere. Probing stops at the first **confirmed** match.
  - **An existing but empty board** (0 postings) with no board-level name, i.e. Lever, Ashby or Recruitee, can't prove identity. It counts as not found, not ambiguous, so it doesn't flood manual review.
  - **SmartRecruiters page URL:** use the detail's `postingUrl` instead of building the link.
  - **Board incremental state:** since boards no longer store jobs, `latestPostedAt` for boards is read from a new `fetch_runs.latest_posted_at` column (T22).
  - **Company CLI subcommands:** besides `add` and `review`, add `confirm`, `reject` and `sample` (for the spot-check).
  - **Workable is kept:** the earlier "0 jobs" came from guessed slugs; real customers like `modash` return jobs.

## Out of scope
- Ranking, embeddings, preferences, Claude, UI (M3+). No new dependencies (none are needed).
- Fetching company websites or careers pages (only parse URLs we already have).
- Changing M1 board adapters beyond what T1, T2, T6 and T22 state.
- Any ATS other than the 6.
- Running `npm run test:live` more than once per task that asks for it, or using `--force` on Remotive.

## Tasks

### T0: Branch, baseline, fresh DB
- Steps: `git switch main && git pull && git switch -c feat/m2-companies-ats`, `nvm use`, `npm test`, then `rm -f data/jobs.db data/jobs.db-wal data/jobs.db-shm`.
- Verify: `Test Files 23 passed`, `Tests 321 passed`. If the numbers differ, stop and report.
- This task has no commit.
- [x] Done

---

### Part A: Cleanup and schema

### T1: Remove the HN and Get on Board adapters
- **Delete:**
  - `src/sources/boards/hn-hiring.ts` and its `.test.ts`
  - `src/sources/boards/getonboard.ts` and its `.test.ts`
  - `test/fixtures/hn-hiring/`
  - `test/fixtures/getonboard/`
- **Edit:**
  - `src/core/job.ts`: remove `"getonboard"` and `"hn-hiring"` from `SOURCE_IDS`.
  - `src/sources/registry.ts`: remove both imports and entries.
  - `src/sources/registry.test.ts`: the order list becomes `["remoteok","weworkremotely","remotive","himalayas","jobicy","workingnomads","arbeitnow"]`, and the `360` interval check keeps only `remotive`.
  - `src/test-utils/fixture-routes.ts`: remove the Get on Board and HN routes (and the `GOB_CATEGORIES` constant).
  - `src/scripts/fetch-cli.integration.test.ts`:
    - remove the `getonboard` and `hn-hiring` rows from `EXPECTED_FIRST_RUN`
    - `TOTAL_JOBS` becomes `17`
    - the `"skips everything"` and `"--force"` tests use `Array(7)` instead of `Array(9)`
    - the `fetch_runs` length becomes `7`
  - `src/scripts/fetch-cli.test.ts`: the exact unknown-source message becomes `Unknown source: nope. Valid: remoteok, weworkremotely, remotive, himalayas, jobicy, workingnomads, arbeitnow`.
- Verify: `npm run lint && npm run typecheck && npm test` all pass; `grep -rn "getonboard\|hn-hiring\|hnHiring" src test` prints nothing.
- Commit type: `refactor`.
- [x] Done

### T2: `Job` schema v2 and a fresh first migration (depends on T1)
- **Files:**
  - `src/core/job.ts`, `src/core/job.test.ts`
  - `src/db/schema.ts`
  - the 7 board adapters and their tests
  - `src/db/queries.test.ts`, `src/sources/run-adapter.test.ts`, `src/sources/runner.test.ts`
  - `drizzle/`: **delete the folder and regenerate it.** This one-time rewrite is approved: the DB is fresh, so nothing has applied the old migration.
- **`src/core/job.ts`:**
  ```ts
  export const BOARD_IDS = ["remoteok","weworkremotely","remotive","himalayas","jobicy","workingnomads","arbeitnow"] as const;
  export const ATS_IDS = ["greenhouse","lever","ashby","workable","recruitee","smartrecruiters"] as const;
  export const SOURCE_IDS = [...BOARD_IDS, ...ATS_IDS] as const;
  export type BoardId = (typeof BOARD_IDS)[number];
  export type AtsId = (typeof ATS_IDS)[number];
  export type SourceId = (typeof SOURCE_IDS)[number];
  export const WORKPLACE_TYPES = ["remote","hybrid","onsite"] as const;
  export type WorkplaceType = (typeof WORKPLACE_TYPES)[number];
  // JobSchema: remove `remote`; add (keep all other fields unchanged):
  workplaceType: z.enum(WORKPLACE_TYPES).nullable(),
  departments: z.array(z.string()),
  regions: z.array(z.string()),
  employmentType: z.string().nullable(),
  ```
- **Board adapter `normalize` changes:**
  - `workplaceType`: `"remote"` for remoteok, weworkremotely, remotive, himalayas, jobicy and workingnomads. For arbeitnow: `raw.remote ? "remote" : null`.
  - `departments: []`, `regions: []`, `employmentType: null` for all 7.
  - No other changes.
- **Tests:** replace every `remote: …` in literal expectations with the matching `workplaceType`, and add `departments: []`, `regions: []`, `employmentType: null`. Do the same in `makeJob` (queries test), `job.test.ts`'s `valid` job, and the fake `normalize` functions in `run-adapter.test.ts` and `runner.test.ts`.
- **`src/db/schema.ts` `jobs`:**
  - remove `remote`
  - add `workplaceType: text("workplace_type")`
  - add `departments: text("departments", { mode: "json" }).$type<string[]>().notNull().default([])`
  - add `regions` the same way
  - add `employmentType: text("employment_type")`
- **Then:** `rm -rf drizzle && npm run db:generate`. Commit the generated files without editing them.
- **Tests first** (`job.test.ts`): `rejects an unknown workplaceType` and `accepts every ATS source id`.
- Verify: `npm run lint && npm run typecheck && npm test` pass; `ls drizzle` shows exactly one `0000_*.sql`.
- Commit type: `feat`.
- [x] Done

### T3: `companies` and `company_candidates` tables, plus job links (depends on T2)
- **Files:** `src/db/schema.ts`, `src/db/client.test.ts`, `drizzle/` (new migration via `npm run db:generate`; do **not** delete the T2 migration).
- **`companies` table:**
  | column | type | notes |
  |---|---|---|
  | `id` | integer pk autoincrement | |
  | `ats` | text notNull, enum `ATS_IDS` | |
  | `slug` | text notNull | |
  | `name` | text notNull | display name |
  | `website` | text | |
  | `homeCountry` (`home_country`) | text | ISO 3166-1 alpha-2, uppercase |
  | `origin` | text notNull | `seed:remoteintech` \| `seed:yc` \| `board:<boardId>` \| `manual` |
  | `status` | text notNull, enum `["active","inactive"]`, default `active` | |
  | `consecutiveFailures` (`consecutive_failures`) | integer notNull default 0 | counts consecutive 404s only |
  | `lastFetchedAt` (`last_fetched_at`) | text | last **successful** fetch |
  | `lastError` (`last_error`) | text | |
  | `createdAt` (`created_at`) | text notNull | |

  Plus a unique index `companies_ats_slug_uq` on (`ats`, `slug`).
- **`company_candidates` table:**
  | column | type | notes |
  |---|---|---|
  | `id` | integer pk autoincrement | |
  | `normalizedName` (`normalized_name`) | text notNull **unique** | `normalizeCompany(name)` |
  | `name` | text notNull | |
  | `website` | text | |
  | `careersUrl` (`careers_url`) | text | |
  | `atsHints` (`ats_hints`) | json `string[]` notNull default `[]` | ATS URLs seen in board postings |
  | `homeCountry` (`home_country`) | text | |
  | `origin` | text notNull | same values as `companies.origin` |
  | `status` | text notNull, enum `["pending","confirmed","ambiguous","not_found","error"]`, default `pending` | |
  | `attempts` | integer notNull default 0 | |
  | `lastCheckedAt` (`last_checked_at`) | text | |
  | `nextCheckAt` (`next_check_at`) | text | null means due now |
  | `companyId` (`company_id`) | integer, references `companies.id` | |
  | `ambiguousMatches` (`ambiguous_matches`) | json `{ ats: string; slug: string }[]` notNull default `[]` | |
  | `createdAt` (`created_at`) | text notNull | |

  Plus an index on (`status`, `next_check_at`).
- **`jobs` additions:**
  - `companyId: integer("company_id").references(() => companies.id, { onDelete: "set null" })`
  - `closedAt: text("closed_at")`
  - an index on `company_id` and an index on `closed_at`
- **Tests first** (`client.test.ts`):
  - `creates companies and company_candidates`: insert and select one row each
  - `enforces unique ats+slug on companies`
  - `enforces unique normalized_name on company_candidates`
  - `jobs accept company_id and closed_at`
- Verify: `npm test -- src/db` passes; `ls drizzle` shows `0000_*` and `0001_*`.
- Commit type: `feat`.
- [x] Done

---

### Part B: Pure core logic (TDD, no network, no DB)

### T4: Country and region mapping (`src/core/locations.ts`)
- **Interfaces:**
  ```ts
  export const REGIONS = ["argentina","latam","south-america","americas","worldwide","latam-country","north-america","europe","emea","apac"] as const;
  export type Region = (typeof REGIONS)[number];
  export const ALLOWED_JOB_REGIONS: readonly Region[] = ["argentina","latam","south-america","americas","worldwide"];
  export function countryCodeFromName(name: string): string | null;   // ISO alpha-2 or null
  export function deriveRegions(locationTexts: string[]): Region[];   // unique, sorted alphabetically
  export function deriveWorkplaceType(structured: WorkplaceType | null, locationTexts: string[]): WorkplaceType | null;
  ```
- **Country table:** one array of `{ code, names: string[], region }`. Matching is case-insensitive and **whole-word**: build each pattern as `(?<![\p{L}\p{N}])<escaped name>(?![\p{L}\p{N}])` with the `iu` flags. The table holds exactly these entries; spellings are listed English first, then Spanish:
  - **`argentina` region:** `AR` ["Argentina", "Buenos Aires"].
  - **`latam-country` region:**
    - `BR` ["Brazil", "Brasil"]
    - `MX` ["Mexico", "México"]
    - `CO` ["Colombia"]
    - `CL` ["Chile"]
    - `PE` ["Peru", "Perú"]
    - `UY` ["Uruguay"]
    - `PY` ["Paraguay"]
    - `BO` ["Bolivia"]
    - `EC` ["Ecuador"]
    - `VE` ["Venezuela"]
    - `CR` ["Costa Rica"]
    - `PA` ["Panama", "Panamá"]
    - `GT` ["Guatemala"]
    - `SV` ["El Salvador"]
    - `HN` ["Honduras"]
    - `NI` ["Nicaragua"]
    - `DO` ["Dominican Republic", "República Dominicana"]
    - `CU` ["Cuba"]
    - `PR` ["Puerto Rico"]
  - **`north-america` region:** `US` ["United States", "United States of America", "USA", "US", "U.S.", "U.S.A.", "Estados Unidos", "EEUU"], `CA` ["Canada", "Canadá"].
  - **`europe` region:**
    - `GB` ["United Kingdom", "UK", "U.K.", "Great Britain", "England", "Scotland", "Wales", "Reino Unido"]
    - `IE` ["Ireland", "Irlanda"]
    - `DE` ["Germany", "Alemania", "Deutschland"]
    - `FR` ["France", "Francia"]
    - `ES` ["Spain", "España"]
    - `PT` ["Portugal"]
    - `IT` ["Italy", "Italia"]
    - `NL` ["Netherlands", "The Netherlands", "Países Bajos", "Holland"]
    - `BE` ["Belgium", "Bélgica"]
    - `LU` ["Luxembourg"]
    - `CH` ["Switzerland", "Suiza"]
    - `AT` ["Austria"]
    - `DK` ["Denmark", "Dinamarca"]
    - `SE` ["Sweden", "Suecia"]
    - `NO` ["Norway", "Noruega"]
    - `FI` ["Finland", "Finlandia"]
    - `IS` ["Iceland"]
    - `PL` ["Poland", "Polonia"]
    - `CZ` ["Czech Republic", "Czechia"]
    - `SK` ["Slovakia"]
    - `HU` ["Hungary", "Hungría"]
    - `RO` ["Romania", "Rumania"]
    - `BG` ["Bulgaria"]
    - `GR` ["Greece", "Grecia"]
    - `HR` ["Croatia", "Croacia"]
    - `SI` ["Slovenia"]
    - `RS` ["Serbia"]
    - `EE` ["Estonia"]
    - `LV` ["Latvia"]
    - `LT` ["Lithuania"]
    - `UA` ["Ukraine", "Ucrania"]
    - `CY` ["Cyprus"]
    - `MT` ["Malta"]
  - **`apac` region:**
    - `AU` ["Australia"]
    - `NZ` ["New Zealand", "Nueva Zelanda"]
    - `IN` ["India"]
    - `SG` ["Singapore", "Singapur"]
    - `JP` ["Japan", "Japón"]
    - `CN` ["China"]
    - `HK` ["Hong Kong"]
    - `TW` ["Taiwan"]
    - `KR` ["South Korea", "Korea"]
    - `ID` ["Indonesia"]
    - `PH` ["Philippines", "Filipinas"]
    - `VN` ["Vietnam"]
    - `TH` ["Thailand"]
    - `MY` ["Malaysia"]
    - `PK` ["Pakistan"]
    - `BD` ["Bangladesh"]
    - `LK` ["Sri Lanka"]
  - **`emea` region:**
    - `IL` ["Israel"]
    - `AE` ["United Arab Emirates", "UAE", "Dubai"]
    - `SA` ["Saudi Arabia"]
    - `TR` ["Turkey", "Türkiye", "Turquía"]
    - `EG` ["Egypt"]
    - `NG` ["Nigeria"]
    - `KE` ["Kenya"]
    - `ZA` ["South Africa", "Sudáfrica"]
    - `MA` ["Morocco"]
    - `GH` ["Ghana"]
- **Area phrases** (same matching rules):
  - `latam`: "LATAM", "Latin America", "Latinoamérica", "Latinoamerica", "América Latina", "America Latina"
  - `south-america`: "South America", "Sudamérica", "Sudamerica", "América del Sur"
  - `americas`: "Americas", "The Americas"
  - `north-america`: "North America", "NAMER"
  - `europe`: "Europe", "EU", "European Union", "Europa"
  - `emea`: "EMEA"
  - `apac`: "APAC", "Asia"
  - `worldwide`: "Anywhere", "Worldwide", "Global"
- **`deriveRegions`:**
  - Check every text against **every** phrase and country name; regions are the union.
  - "North America" must not also yield `americas`. Match phrases first, **remove the matched spans** from the text, then match the remaining text against country names and the remaining phrases. Removing spans also stops "Latin America" from matching "America" (which isn't a phrase anyway).
  - Return a unique, alphabetically sorted list.
- **`countryCodeFromName`:** returns the code if `name` **exactly** equals one of the table's names (case-insensitive, trimmed), otherwise `null`. It's used for YC's last location token ("USA", "United Kingdom").
- **`deriveWorkplaceType`:**
  1. If `structured` isn't null, return it.
  2. Otherwise join the texts with `" | "` and lowercase them. A whole-word `remote|anywhere|worldwide|remoto` → `"remote"`. Otherwise `hybrid|híbrido|hibrido` → `"hybrid"`. Otherwise `onsite|on-site|on site|in office|in-office|presencial` → `"onsite"`.
  3. Otherwise, if any text is non-empty after trimming → `"onsite"` (a city-only location is an office).
  4. Otherwise `null`.
- **Tests first** (`src/core/locations.test.ts`), using `it.each` with exact expected arrays:
  - `deriveRegions`:
    - `["Remote - LATAM"]` → `["latam"]`
    - `["Remote (Americas)"]` → `["americas"]`
    - `["North America"]` → `["north-america"]`
    - `["Remote - US only"]` → `["north-america"]`
    - `["Remote, United States"]` → `["north-america"]`
    - `["Remote - Brazil"]` → `["latam-country"]`
    - `["Remote - Brazil, Argentina"]` → `["argentina","latam-country"]`
    - `["Buenos Aires, Argentina"]` → `["argentina"]`
    - `["Remote - Europe"]` → `["europe"]`
    - `["EMEA"]` → `["emea"]`
    - `["Remote - India"]` → `["apac"]`
    - `["Anywhere"]` → `["worldwide"]`
    - `["Remote"]` → `[]`
    - `["Remote - US", "Remote - LATAM"]` → `["latam","north-america"]`
    - `["Latinoamérica (remoto)"]` → `["latam"]`
    - `["San Francisco, CA"]` → `[]`
    - `["Austin, US"]` → `["north-america"]`
    - `["Russia"]` → `[]` (not in the table)
    - `["Customer success"]` → `[]` (no "us" word match inside "customer")
  - `countryCodeFromName`: `"USA"` → `"US"`, `"United Kingdom"` → `"GB"`, `" canada "` → `"CA"`, `"Argentina"` → `"AR"`, `"Atlantis"` → `null`.
  - `deriveWorkplaceType`:
    - `("hybrid", ["Remote"])` → `"hybrid"`
    - `(null, ["Remote - LATAM"])` → `"remote"`
    - `(null, ["Hybrid - London"])` → `"hybrid"`
    - `(null, ["On-site, Berlin"])` → `"onsite"`
    - `(null, ["San Francisco, CA"])` → `"onsite"`
    - `(null, ["", "  "])` → `null`
    - `(null, [])` → `null`
    - `(null, ["Remoto - Argentina"])` → `"remote"`
- Verify: `npm test -- src/core/locations.test.ts` passes.
- Commit type: `feat`.
- [x] Done

### T5: Location filter (`src/core/location-filter.ts`, depends on T4)
- **Interfaces:**
  ```ts
  export const ALLOWED_HOME_COUNTRIES: ReadonlySet<string>; // "US","CA","AU","NZ" + every code whose region is "europe" in the T4 table
  export function isAllowedHomeCountry(code: string | null): boolean; // null → true (unknown passes)
  export type LocationVerdict = { pass: true } | { pass: false; reason: "hybrid" | "onsite" | "region" | "company_country" };
  export function checkLocation(job: Pick<Job, "workplaceType" | "regions">, homeCountry: string | null): LocationVerdict;
  ```
- **Behavior:** check in this order and return the first failure:
  1. `workplaceType` is `hybrid` → `"hybrid"`; `onsite` → `"onsite"`. `remote` or `null` continue.
  2. If `regions` is non-empty and none of them is in `ALLOWED_JOB_REGIONS` → `"region"`. An empty `regions` passes.
  3. `!isAllowedHomeCountry(homeCountry)` → `"company_country"`.
- **Tests first** (`location-filter.test.ts`, `it.each`):
  - pass:
    - `{remote, ["latam"]}` with home `US`
    - `{remote, ["americas"]}` with `GB`
    - `{remote, ["worldwide"]}` with `null`
    - `{remote, []}` with `CA`
    - `{remote, ["latam","north-america"]}` with `AU`
    - `{remote, ["argentina","latam-country"]}` with `NZ`
    - `{null, []}` with `DE`
    - `{remote, ["argentina"]}` with `US` (a foreign company hiring from Argentina)
  - fail:
    - `{hybrid, ["latam"]}` with `US` → `hybrid`
    - `{onsite, []}` → `onsite`
    - `{remote, ["north-america"]}` → `region`
    - `{remote, ["latam-country"]}` → `region`
    - `{remote, ["europe"]}` → `region`
    - `{remote, ["apac"]}` → `region`
    - `{remote, ["latam"]}` with `AR` → `company_country`
    - with `BR` → `company_country`
    - with `IN` → `company_country`
  - `isAllowedHomeCountry`: `US`, `CA`, `GB`, `DE`, `CH`, `NO`, `AU`, `NZ` and `null` → true; `AR`, `BR`, `IN`, `IL`, `SG` → false.
- Verify: `npm test -- src/core/location-filter.test.ts` passes.
- Commit type: `feat`.
- [x] Done

### T6: Replace the tech filter keywords (`src/core/tech-filter.ts`, depends on T2)
- **Interface:** `export const TECH_KEYWORDS: readonly string[]` and `export function isTechJob(job: Pick<Job, "title" | "departments" | "tags">): boolean`.
- **Keywords** (exactly these): `full stack`, `fullstack`, `front end`, `frontend`, `back end`, `backend`, `software engineer`, `software developer`, `web developer`, `web engineer`, `ui engineer`, `ui developer`, `product engineer`, `javascript`, `typescript`, `js`, `ts`, `react`, `react.js`, `reactjs`, `next.js`, `nextjs`, `node`, `node.js`, `nodejs`, `martech`, `marketing technology`, `segment`, `snowflake`, `aws`.
- **Matching:**
  1. Build the haystack as `[title, ...departments, ...tags].join(" | ")`, lowercased, with every `-`, `_` and `/` replaced by a space and runs of spaces collapsed to one.
  2. Each keyword matches as `(?<![a-z0-9])<escaped keyword>(?![a-z0-9])`.
  3. Descriptions are never used. "next" alone is **not** a keyword.
- **`run-adapter.ts`** keeps `adapter.techFilter && !isTechJob(job)`. Only the keyword list changes; board `techFilter` flags stay as they are (T22 changes them).
- **Tests first:** rewrite `tech-filter.test.ts` as a decision table (`it.each`):
  - **true:**
    - "Senior Full-Stack Engineer", "Frontend Engineer", "Back-End Developer", "Software Engineer", "Senior Software Developer", "Web Developer", "UI Engineer", "Product Engineer"
    - "React Native Developer" (accepted false positive: mobile)
    - "Node.js Developer", "TypeScript Engineer", "Next.js Developer", "Martech Engineer", "Marketing Technology Manager", "Snowflake Data Engineer", "AWS Cloud Engineer"
    - `{title:"Rockstar", departments:["Frontend"]}`
    - `{title:"Rockstar", tags:["full stack programming"]}`
  - **false:**
    - "Account Executive", "Sales Engineer", "Data Scientist", "DevOps Engineer", "Site Reliability Engineer", "Security Guard", "Registered Nurse", "Customer Success Manager", "Product Manager"
    - "Next Generation Sales Lead" ("next" alone)
    - "Engineer"
  - **every keyword matches itself:** `it.each(TECH_KEYWORDS)`.
  - **known false positive, documented in a comment:** "Segment Marketing Manager" → true. This is accepted, because Claude scoring in M4 handles it.
- **Expected count changes in existing tests.** These were computed from the committed fixtures on 2026-11-16; if your result differs, stop and report rather than adjusting the numbers.
  - `remoteok`: `runAdapter` still gives `filtered: 1`, 3 jobs.
  - `remotive`: `filtered: 3`, 0 jobs.
  - `himalayas`: `filtered: 2`, 1 job.
  - `workingnomads`: `filtered: 2`, 1 job.
  - `arbeitnow`: `filtered: 2`, 1 job.
  - `weworkremotely` and `jobicy` are unchanged (their `techFilter` is still false).
  - **Integration `EXPECTED_FIRST_RUN`** (fetched / inserted / updated / invalid / filtered):
    | source | fetched | inserted | updated | invalid | filtered |
    |---|---|---|---|---|---|
    | remoteok | 4 | 3 | 0 | 0 | 1 |
    | weworkremotely | 15 | 3 | 0 | 0 | 0 |
    | remotive | 3 | 0 | 0 | 0 | 3 |
    | himalayas | 3 | 1 | 0 | 0 | 2 |
    | jobicy | 3 | 3 | 0 | 0 | 0 |
    | workingnomads | 3 | 1 | 0 | 0 | 2 |
    | arbeitnow | 3 | 1 | 0 | 0 | 2 |

    That's `TOTAL_JOBS = 12`. Remotive inserting 0 is fine.
- Verify: `npm test` passes.
- Commit type: `feat`.
- [x] Done

### T7: Slugs and ATS URLs (`src/companies/slugs.ts`, depends on T2)
- **Interfaces:**
  ```ts
  export interface AtsRef { ats: AtsId; slug: string }
  export function parseAtsUrl(url: string): AtsRef | null;
  export function extractAtsRefs(text: string): AtsRef[];       // all matches, unique by ats+slug, in order of appearance
  export function websiteDomain(url: string | null | undefined): string | null; // hostname, lowercase, leading "www." removed; null if unparseable
  export function slugGuesses(name: string, website: string | null): string[];  // at most 3, unique, in order
  ```
- **URL patterns for `parseAtsUrl` and `extractAtsRefs`.** Match against the URL or text after replacing `&#x2F;` and `\/` with `/`. Only `smartrecruiters` keeps the slug's case; all other slugs are lowercased.
  | ats | pattern (slug = capture 1) | ignored slugs |
  |---|---|---|
  | greenhouse | `(?:boards\|job-boards)(?:\.eu)?\.greenhouse\.io/(?:embed/job_app\?for=)?([a-z0-9_-]+)` (case-insensitive) | `embed`, `api` |
  | lever | `jobs\.(?:eu\.)?lever\.co/([a-z0-9_.-]+?)(?=[/?#"'\s]\|$)` | |
  | ashby | `jobs\.ashbyhq\.com/([a-z0-9_.-]+)` | `api` |
  | workable | `apply\.workable\.com/([a-z0-9_-]+)` | `j`, `api` |
  | recruitee | `https?://([a-z0-9-]+)\.recruitee\.com` | `www`, `app`, `api` |
  | smartrecruiters | `jobs\.smartrecruiters\.com/([A-Za-z0-9_-]+)` | `oneclick-ui`, `api` |

  Strip trailing dots from the slug (`weloglobal.` → `weloglobal`).
- **`slugGuesses(name, website)`:**
  1. Take `n = name` lowercased; remove a trailing legal suffix using the same list and rules as `normalizeCompany` (reuse its suffix logic, exported from `src/core/dedupe.ts` as `stripLegalSuffixes(name: string): string`); replace `&` with `and`; trim.
  2. Guess A: `n` with every non-`[a-z0-9]` character removed.
  3. Guess B: `n` with runs of non-`[a-z0-9]` characters replaced by `-`, and leading/trailing `-` trimmed.
  4. Guess C: the first label of `websiteDomain(website)` (e.g. `acmelabs.io` → `acmelabs`, `app.acme.com` → `app`), only if it's at least 2 characters long.
  5. Drop empty guesses, keep order, remove duplicates, and return at most 3.
- **Tests first** (`slugs.test.ts`):
  - `parseAtsUrl`:
    - `https://boards.greenhouse.io/Acme/jobs/123` → `{greenhouse, "acme"}`
    - `https://job-boards.greenhouse.io/acme` → greenhouse/acme
    - `https://boards.greenhouse.io/embed/job_app?for=acme&token=1` → greenhouse/acme
    - `https://jobs.lever.co/weloglobal./abc` → lever/weloglobal
    - `https://jobs.eu.lever.co/acme/` → lever/acme
    - `https://jobs.ashbyhq.com/livekit/uuid` → ashby/livekit
    - `https://apply.workable.com/modash/j/ABC/` → workable/modash
    - `https://apply.workable.com/j/ABC` → `null`
    - `https://tether.recruitee.com/o/x` → recruitee/tether
    - `https://jobs.smartrecruiters.com/BoschGroup/123` → smartrecruiters/`BoschGroup`
    - `https://example.com/careers` → `null`
  - `extractAtsRefs`: escaped HTML with `https:&#x2F;&#x2F;jobs.lever.co&#x2F;acme&#x2F;1` plus a duplicate → `[lever/acme]`.
  - `websiteDomain`: `https://www.Acme.io/about` → `"acme.io"`; `"not a url"` → `null`; `null` → `null`.
  - `slugGuesses`:
    - `("Acme Labs, Inc.", "https://acmelabs.io")` → `["acmelabs","acme-labs"]` (C equals A, so it's dropped)
    - `("Silver.dev", null)` → `["silverdev","silver-dev"]`
    - `("AT&T", null)` → `["atandt","at-and-t"]`
    - `("Globex", "https://www.globex.com")` → `["globex"]`
    - `("Quantum-Systems GmbH", "https://quantum-systems.com")` → `["quantumsystems","quantum-systems"]`
- Verify: `npm test -- src/companies/slugs.test.ts` and `npm test -- src/core/dedupe.test.ts` pass.
- Commit type: `feat`.
- [x] Done

### T8: Per-host paced HTTP client (`src/core/paced-http.ts`, depends on T2)
- **Interface:**
  ```ts
  export interface PacingOptions {
    minIntervalMs?: number;                    // default 500: gap between request STARTS to the same host
    perHostMinIntervalMs?: Record<string, number>; // per-host override, e.g. { "raw.githubusercontent.com": 100 }
    now?: () => number;                        // default Date.now
    sleep?: (ms: number) => Promise<void>;     // default setTimeout-based
  }
  export function createPacedHttpClient(inner: HttpClient, opts?: PacingOptions): HttpClient;
  ```
- **Behavior:**
  - Requests to the same host (`new URL(url).host`) run **one at a time, in call order**. A request starts only after the previous one to that host has settled **and** `minIntervalMs` has passed since the previous start.
  - Different hosts run independently and in parallel.
  - Errors pass through unchanged; a failed request still counts for pacing.
  - The paced client wraps **any** `HttpClient`, including fixture ones.
- **Tests first** (`paced-http.test.ts`, with a fake clock: `now` returns a counter that `sleep(ms)` advances):
  - `serializes requests to one host`: three concurrent `getJson` calls to `a.com` start at t = 0, 500 and 1000.
  - `different hosts run in parallel`: `a.com` and `b.com` both start at t = 0.
  - `per-host override`: `raw.githubusercontent.com` with 100 → starts at 0 and 100.
  - `errors propagate and still pace`: the first call rejects, the second starts at t = 500.
  - `preserves call order per host`.
- Verify: `npm test -- src/core/paced-http.test.ts` passes.
- Commit type: `feat`.
- [x] Done

---

### Part C: Database queries

### T9: Company and candidate queries (`src/db/companies.ts`, depends on T3)
- **Interfaces** (all synchronous, as in `queries.ts`):
  ```ts
  export type CandidateInput = { name: string; website?: string | null; careersUrl?: string | null; atsHints?: string[]; homeCountry?: string | null; origin: string };
  export function upsertCandidate(db: Db, input: CandidateInput, nowIso: string): "inserted" | "updated" | "unchanged";
  export function listDueCandidates(db: Db, nowIso: string, limit?: number): CandidateRow[];
  export function recordResolution(db: Db, candidateId: number, result: Resolution, nowIso: string): { companyId: number | null };
  export function insertOrGetCompany(db: Db, c: { ats: AtsId; slug: string; name: string; website: string | null; homeCountry: string | null; origin: string }, nowIso: string): number;
  export function listDueCompanies(db: Db, ats: AtsId, nowIso: string, opts?: { force?: boolean; minHours?: number }): CompanyRow[]; // minHours default 20
  export function recordCompanyFetch(db: Db, companyId: number, outcome: { kind: "success" } | { kind: "not_found"; error: string } | { kind: "error"; error: string }, nowIso: string): void;
  export function listAmbiguousCandidates(db: Db): CandidateRow[];
  export function companyCounts(db: Db): { active: number; inactive: number; byAts: Record<string, number> };
  ```
  `Resolution` is defined in T17. For this task, declare it in `src/companies/types.ts`:
  ```ts
  export type Resolution =
    | { status: "confirmed"; ats: AtsId; slug: string; companyName: string | null }
    | { status: "ambiguous"; matches: AtsRef[] }
    | { status: "not_found" }
    | { status: "error"; error: string };
  ```
- **`upsertCandidate`** keys on `normalizeCompany(input.name)`:
  - **New:** insert with `status: "pending"` and `nextCheckAt: null`.
  - **Existing:** fill **only missing** `website`, `careersUrl` and `homeCountry`; union `atsHints` (unique, keeping order); never change `origin`, `name` or `status`, except one case: if the status is `not_found` or `error` **and** this call added a new ATS hint, set `status: "pending"` and `nextCheckAt: null`. Return `"updated"` if anything changed, otherwise `"unchanged"`.
  - Ignore empty names: return `"unchanged"`, insert nothing.
- **`listDueCandidates`:** `status = "pending"`, or `status in ("not_found","error") AND next_check_at <= nowIso`. Ordered by `created_at`, then `id`.
- **`recordResolution`:** always sets `attempts += 1` and `lastCheckedAt = nowIso`.
  - `confirmed` → `insertOrGetCompany` with the candidate's name, website, home country and origin; candidate `status: "confirmed"`, `companyId`, `ambiguousMatches: []`, `nextCheckAt: null`.
  - `ambiguous` → `status: "ambiguous"`, `ambiguousMatches: matches`, `nextCheckAt: null`.
  - `not_found` → `nextCheckAt = nowIso + 30 days`.
  - `error` → `nextCheckAt = nowIso + 1 day`.
- **`insertOrGetCompany`:** if (`ats`, `slug`) exists, return its id unchanged; otherwise insert with `status: "active"`.
- **`listDueCompanies`:** `status = "active"` and the right `ats`, and (`last_fetched_at IS NULL` or `last_fetched_at <= nowIso − minHours`), unless `force`. Ordered by `id`.
- **`recordCompanyFetch`:**
  - `success` → `consecutiveFailures = 0`, `lastFetchedAt = nowIso`, `lastError = null`.
  - `not_found` → `consecutiveFailures += 1` and `lastError = error`. If it reaches **3**: `status = "inactive"`, and the linked candidate (where `company_candidates.company_id = id`) gets `status: "pending"`, `nextCheckAt: null`, `companyId: null`.
  - `error` → only `lastError = error`; the failure count and `lastFetchedAt` are unchanged, so the company is retried on the next run.
- **Tests first** (`src/db/companies.test.ts`, in-memory DB): one `it` per rule above, at least:
  - `inserts a new candidate as pending`
  - `merges by normalized name and fills only missing fields`
  - `unions ats hints`
  - `new hint re-opens a not_found candidate`
  - `due candidates include pending and expired not_found/error only`
  - `confirmed resolution creates a company and links it`
  - `confirmed resolution reuses an existing company`
  - `not_found sets next check +30 days`
  - `error sets next check +1 day`
  - `due companies respect minHours and force`
  - `three consecutive 404s deactivate and reopen the candidate`
  - `a success resets failures`
  - `a non-404 error keeps lastFetchedAt`
- Verify: `npm test -- src/db/companies.test.ts` passes.
- Commit type: `feat`.
- [x] Done

### T10: Job storage for ATS jobs (`src/db/queries.ts`, depends on T3)
- **Changes:**
  ```ts
  export function upsertJobs(db: Db, items: Job[], nowIso: string, opts?: { companyId?: number }): { inserted: number; updated: number };
  export function markClosedJobs(db: Db, companyId: number, seenExternalIds: string[], nowIso: string): number; // returns rows newly closed
  export function purgeClosedJobs(db: Db, nowIso: string, days?: number): number; // default 30; returns rows deleted
  export function countJobs(db: Db, opts?: { source?: SourceId; openOnly?: boolean }): number;
  export function latestPostedAt(db: Db, source: SourceId): string | null; // unchanged for now (T22 changes it for boards)
  ```
- **`upsertJobs`:**
  - Sets `companyId` from `opts.companyId` (inserts and updates).
  - Every upserted job gets `closedAt = null`, which reopens a job that reappears.
  - Everything else (dedupe, `duplicateOf`) is unchanged.
- **`markClosedJobs`:** sets `closedAt = nowIso` for jobs with this `company_id`, `closed_at IS NULL` and `external_id NOT IN seen`. If `seen` is empty, close all of the company's open jobs.
- **`purgeClosedJobs`:** deletes jobs where `closed_at <= nowIso − days`. Before deleting, set `duplicate_of = NULL` on rows pointing at the deleted ids (the FK would otherwise fail).
- **`countJobs`:** keep the old call shape working by also accepting a plain `SourceId` as the second argument (overload), so existing callers don't break.
- **Tests first** (`queries.test.ts`, additions):
  - `stores companyId`
  - `markClosedJobs closes only unseen open jobs of that company`
  - `reappearing job is reopened by upsert`
  - `purge deletes jobs closed more than 30 days ago only`
  - `purge clears duplicate_of pointers first`
  - `countJobs openOnly excludes closed jobs`
- Verify: `npm test -- src/db` passes.
- Commit type: `feat`.
- [x] Done

---

### Part D: ATS adapters
**Shared rules for T11–T16:**
- **File:** `src/sources/ats/<id>.ts`, exporting `<id>` (the adapter, via `defineAdapter`) and `probe<Id>` (for resolution, T17). `<Id>` is PascalCase (e.g. `probeGreenhouse`).
- **Adapter metadata:**
  - `id` from `ATS_IDS`, `name` (e.g. `"Greenhouse"`), `homepage` (the vendor's site)
  - `minIntervalMinutes: 0`: unused, because ATS pacing is per company (T23)
  - `techFilter: false`: the ATS runner applies the storage filters itself
- **`FetchContext.companies`:** add `companies?: CompanyRef[]` to `FetchContext` in `src/sources/types.ts`, together with:
  ```ts
  export interface CompanyRef { id: number; ats: AtsId; slug: string; name: string; homeCountry: string | null }
  ```
  `fetch(ctx)` throws `Error("<id>: no companies in context")` if `ctx.companies` is missing or empty. Otherwise it fetches each company in order and returns **wrapper items** `{ company: CompanyRef, item: unknown }`. `itemSchema` validates the wrapper as `z.object({ company: CompanyRefSchema, item: <ItemSchema> })`.
- **`normalize({ company, item })`:**
  - `source`: the ATS id
  - `externalId`: `` `${company.slug}:${<ats job id>}` ``
  - `company`: `company.name`
  - `tags: []` unless stated otherwise
  - salary fields `null` unless stated otherwise
  - `descriptionText = htmlToText(descriptionHtml)`
  - `regions = deriveRegions(locationTexts)`
  - `workplaceType = deriveWorkplaceType(structured, locationTexts)`
  - `location`: the location texts joined with `" | "`, or `null` if they're all empty
- **`probe<Id>(http, slug)`** returns
  ```ts
  type ProbeResult = { exists: boolean; postingCount: number; companyName: string | null; texts: string[]; urls: string[] };
  ```
  - Declare `ProbeResult` and `export type ProbeFn = (http: HttpClient, slug: string) => Promise<ProbeResult>` in `src/companies/types.ts`, next to `Resolution` (T9).
  - `HttpError` with status 404 → `{ exists: false, postingCount: 0, companyName: null, texts: [], urls: [] }`.
  - Other errors are **re-thrown**.
  - `texts` = up to 5 postings' plain-text descriptions; `urls` = those postings' URLs.
- **Fixtures:** `test/fixtures/ats/<id>/...`, recorded with `curl -A "job-searcher-mvp/0.1" "<url>"` from the verified slug, then trimmed with a `node -e` one-off to the items named below. Keep descriptions as they are. If the live data lacks a named case, say so in the commit body and use what exists. Never invent fields.
- **Tests per adapter** (`src/sources/ats/<id>.test.ts`), using `createFixtureHttp` with exact routes:
  - `requests the exact url(s)`: `http.calls` equals the expected list
  - `normalizes a typical item`: every `Job` field asserted literally (the M1.1 rule: no `expect.any`, `anything` or `arrayContaining` outside descriptions). Use `expectCleanText` for `descriptionText`.
  - `throws when the envelope has the wrong shape`
  - `throws without companies`
  - `probe: exists with name/texts`
  - `probe: 404 → exists false` (via a route mapped to a 404, see "Fixture HTTP status routes" below)
  - plus the cases listed per adapter
- **Fixture HTTP status routes** (do this in T11, before anything else): extend `createFixtureHttp` so a route value may be `{ status: number }`, which makes `getJson`/`getText` throw `new HttpError(status, url, "HTTP <status> for <url>")`. Also add an optional second argument `{ fallbackStatus?: number }`: if set, unknown URLs throw that `HttpError` instead of `No fixture for`. Test both in `fixture-http.test.ts`.
- **Registry:** in `src/sources/registry.ts`, export `boardAdapters` (the 7, unchanged order), `atsAdapters` (`greenhouse, lever, ashby, workable, recruitee, smartrecruiters`, added one per task) and `adapters = [...boardAdapters, ...atsAdapters]`. Also export `atsProbes: Record<AtsId, (http: HttpClient, slug: string) => Promise<ProbeResult>>`. Update `registry.test.ts` each time: the order list, `covers SOURCE_IDS exactly` (only after T16; until then assert that `adapters` is a subset of `SOURCE_IDS`), and the file-name check, which must look in `boards/` **or** `ats/`.
- **Live checks:** add one `it` per ATS to `adapters.live.test.ts` using the verified slug, asserting `status === "success"`, `jobs.length > 0` and `invalid / fetched < 0.2`. Run it only in T26.

### T11: Greenhouse (depends on T4, T7, T10)
- **Fetch:** `GET https://boards-api.greenhouse.io/v1/boards/<slug>/jobs?content=true`. Envelope `{ jobs: unknown[] }` (passthrough).
- **Item schema:**
  - `id`: number
  - `title`, `absolute_url`: string
  - `location`: `{ name: string }`, nullish
  - `departments`: `{ name: string }[]`, default `[]`
  - `content`: string, default `""`
  - `first_published`: string, nullish
  - `updated_at`: string, nullish
- **Normalize:**
  - `externalId`: `<slug>:<id>`
  - `url`: `absolute_url`; `applyUrl`: null
  - `departments`: the department names
  - `employmentType`: null
  - `descriptionHtml`: `decodeEntities(content)` (Greenhouse escapes its HTML once)
  - `postedAt`: `toIsoUtc(first_published)`, falling back to `null`, **not** `updated_at`
  - location texts: `[location?.name ?? ""]`; structured workplace type: `null`
- **Probe:**
  1. `GET https://boards-api.greenhouse.io/v1/boards/<slug>` → `companyName = name`, `exists: true`.
  2. Then `GET .../jobs?content=true` → `postingCount`, plus `texts` and `urls` from up to 5 jobs.
- **Fixtures:** `jobs.json`, 3 jobs from `mozilla`: one whose location contains "Remote", one city-only, plus one more. Also `board.json` from `/v1/boards/mozilla`.
- **Extra tests:** `decodes escaped content`; `city-only location → onsite`; `remote location → remote`.
- **Also in this task:** the fixture HTTP status routes (shared rules above).
- Verify: `npm test -- src/sources/ats src/test-utils` passes.
- Commit type: `feat`.
- [x] Done

### T12: Lever (depends on T11)
- **Fetch:** `GET https://api.lever.co/v0/postings/<slug>?mode=json`. The envelope is an array.
- **Item schema:**
  - `id`, `text`, `hostedUrl`, `applyUrl`: string
  - `categories`: `{ location?: string | null, team?: string | null, department?: string | null, commitment?: string | null, allLocations?: string[] }`
  - `workplaceType`: string, nullish
  - `createdAt`: number
  - `description`: string, default `""`
  - `lists`: `{ text: string, content: string }[]`, default `[]`
  - `additional`: string, default `""`
  - `salaryRange`: `{ min: number, max: number, currency: string, interval: string }`, nullish
- **Normalize:**
  - `title`: `text`; `url`: `hostedUrl`; `applyUrl`: `applyUrl`
  - `departments`: `[categories.department, categories.team]`, non-empty and unique
  - `employmentType`: `categories.commitment ?? null`
  - `descriptionHtml`: `description` + each list as `<h3>{text}</h3><ul>{content}</ul>` + `additional`
  - `postedAt`: `toIsoUtc(createdAt / 1000)` (**milliseconds**)
  - salary: `salaryRange.min`, `salaryRange.max`, `currency.toUpperCase()`, period = `"year"` if the interval contains "year", `"month"` if it contains "month", `"hour"` if it contains "hour", else `null`
  - location texts: `[categories.location ?? "", ...(categories.allLocations ?? [])]`
  - structured workplace type: `"remote" | "hybrid" | "onsite"` if `workplaceType` is one of those, otherwise (including `"unspecified"`) `null`
- **Probe:** a single GET of the postings. `[]` → `exists: true, postingCount: 0`. `texts`: `descriptionPlain ?? ""` of up to 5 postings (add `descriptionPlain`: string, nullish to the probe parsing). `companyName`: null.
- **Fixtures:** `postings.json`: all 4 `curai` postings (one has `salaryRange`).
- **Extra tests:** `createdAt in ms → correct ISO`; `salaryRange → salary fields`; `"unspecified" falls back to text`.
- Commit type: `feat`.
- [x] Done

### T13: Ashby (depends on T11)
- **Fetch:** `GET https://api.ashbyhq.com/posting-api/job-board/<slug>?includeCompensation=true`. Envelope `{ jobs: unknown[] }`.
- **Item schema:**
  - `id`, `title`, `jobUrl`, `applyUrl`: string
  - `department`, `team`, `employmentType`, `location`, `workplaceType`, `publishedAt`, `descriptionHtml`: string, nullish
  - `secondaryLocations`: `{ location?: string | null }[]`, default `[]`
  - `isRemote`: boolean, nullish
  - `isListed`: boolean, default `true`
  - `compensation`: passthrough object, nullish
- **Fetch filter:** skip items with `isListed === false` before returning them.
- **Normalize:**
  - `url`: `jobUrl`; `applyUrl`: `applyUrl`
  - `departments`: `[department, team]`, non-empty and unique
  - `employmentType`
  - `descriptionHtml ?? ""`
  - `postedAt`: `toIsoUtc(publishedAt)`
  - salary: the first `compensation.compensationTiers[].components[]` with `compensationType === "Salary"` → `minValue`, `maxValue` (null when missing or ≤ 0), `currencyCode`, and period from `interval` (`"1 YEAR"` → year, `"1 MONTH"` → month, `"1 HOUR"` → hour, else `null`). Validate the compensation part with a small Zod schema.
  - location texts: `[location ?? "", ...secondaryLocations.map(l => l.location ?? "")]`
  - structured workplace type: `workplaceType` lowercased with any `-` removed: `"remote"` → remote, `"hybrid"` → hybrid, `"onsite"` → onsite; otherwise `isRemote === true` → remote; otherwise `null`
- **Probe:** a single GET. 404 → not there; `jobs: []` → `exists: true, postingCount: 0`. `texts`: `descriptionPlain`. `companyName`: null.
- **Fixtures:** `job-board.json`: 3 `livekit` jobs: one Remote with a salary component, one Hybrid, one with `secondaryLocations`.
- **Extra tests:** `salary component → salary fields`; `"North America" + secondary "EMEA" → regions ["emea","north-america"]`; `Hybrid → hybrid`; `isListed false is skipped`.
- Commit type: `feat`.
- [x] Done

### T14: Workable (depends on T11)
- **Fetch:** `GET https://apply.workable.com/api/v1/widget/accounts/<slug>?details=true`. Envelope `{ name: string, jobs: unknown[] }`.
- **Item schema:**
  - `shortcode`, `title`, `url`: string
  - `application_url`, `published_on`, `created_at`, `city`, `state`, `country`, `department`, `employment_type`, `description`: string, nullish
  - `telecommuting`: boolean, nullish
  - `locations`: `{ city?: string | null, region?: string | null, country?: string | null }[]`, default `[]`
- **Normalize:**
  - `externalId`: `<slug>:<shortcode>`
  - `url`; `applyUrl`: `application_url ?? null`
  - `departments`: `[department]`, non-empty
  - `employmentType`: `employment_type ?? null`
  - `descriptionHtml`: `description ?? ""`
  - `postedAt`: `toIsoUtc(published_on ?? created_at)`
  - location texts: `[[city, state, country] joined with ", " (empty parts dropped), ...locations.map(l => [l.city, l.region, l.country] joined)]`
  - structured workplace type: `telecommuting === true ? "remote" : null`
- **Probe:** a single GET without `details` → `companyName = name`, `postingCount = jobs.length`.
- **Fixtures:** `account.json`: 3 `modash` jobs (`?details=true`): at least one `telecommuting: true` and one `false`.
- **Extra tests:** `telecommuting true → remote`; `title "(remote, Europe)" with city Tallinn → regions ["europe"]`. That second one is a real case from the verified data: an EU-only remote job that the location filter will drop.
- Commit type: `feat`.
- [ ] Done

### T15: Recruitee (depends on T11)
- **Fetch:** `GET https://<slug>.recruitee.com/api/offers/`. Envelope `{ offers: unknown[] }`.
- **Item schema:**
  - `id`: number
  - `title`, `careers_url`: string
  - `careers_apply_url`, `company_name`, `department`, `location`, `employment_type_code`, `published_at`, `created_at`, `description`, `requirements`: string, nullish
  - `locations`: `{ name?: string | null }[]`, default `[]`
  - `remote`, `hybrid`, `on_site`: boolean, nullish
  - `salary`: `{ min: number | string | null, max: number | string | null, period: string | null, currency: string | null }`, nullish
  - `tags`: string[], default `[]`
- **Normalize:**
  - `url`: `careers_url`; `applyUrl`: `careers_apply_url ?? null`
  - `departments`: `[department]`, non-empty
  - `employmentType`: `employment_type_code ?? null`
  - `tags`: `normalizeTags(tags)`
  - `descriptionHtml`: `description` + `requirements`
  - `postedAt`: `toIsoUtc(published_at ?? created_at)` (format `"2026-11-16 16:33:49 UTC"`; see Gotchas)
  - salary: numeric `min`/`max` (parse strings with `Number`; `NaN` or ≤ 0 → null), `currency`, `salaryPeriodFrom(period)`
  - location texts: `[location ?? "", ...locations.map(l => l.name ?? "")]`
  - structured workplace type: `hybrid === true` → hybrid; else `remote === true` → remote; else `on_site === true` → onsite; else `null`
- **Probe:** a single GET → `companyName = offers[0]?.company_name ?? null`, `postingCount`, and `urls` = `careers_url` values (used for the domain check).
- **Fixtures:** `offers.json`: 3 `tether` offers: one `remote: true` with several `locations`, one `hybrid: true` if any exists, and one more.
- **Extra tests:** `hybrid flag wins`; `published_at "… UTC" parses`; `salary strings are parsed`.
- Commit type: `feat`.
- [ ] Done

### T16: SmartRecruiters (depends on T6, T11)
- **Fetch:**
  1. **List:** `GET https://api.smartrecruiters.com/v1/companies/<slug>/postings?limit=100&offset=<n>`, starting at `n = 0`. Envelope `{ totalFound: number, offset: number, limit: number, content: unknown[] }`. Continue while `offset + limit < totalFound`, for at most 10 pages.
  2. **Pre-filter each list item** before fetching details, to save requests. Build a partial `Job`:
     - `title` = `name`
     - `departments` = `[department?.label, function?.label]`, non-empty
     - `tags: []`
     - `workplaceType` = `location.remote ? "remote" : location.hybrid ? "hybrid" : "onsite"`
     - `regions` = `deriveRegions([location.fullLocation ?? ""])`

     Keep the item only if `isTechJob` passes **and** `checkLocation(partial, company.homeCountry).pass`.
  3. **Detail** for kept items: `GET https://api.smartrecruiters.com/v1/companies/<slug>/postings/<id>`.
  4. Return wrapper items `{ company, item: { list, detail } }`.
- **Item schema:**
  - `list`: `{ id: string, name: string, releasedDate?: string|null, department?: {label?: string|null}|null, function?: {label?: string|null}|null, typeOfEmployment?: {label?: string|null}|null, location: { fullLocation?: string|null, remote?: boolean|null, hybrid?: boolean|null } }`
  - `detail`: `{ postingUrl: string, applyUrl?: string|null, jobAd: { sections: Record<string, { title?: string|null, text?: string|null }> } }`
- **Normalize:**
  - `url`: `detail.postingUrl`; `applyUrl`: `detail.applyUrl ?? null`
  - `departments` as in the pre-filter
  - `employmentType`: `typeOfEmployment?.label ?? null`
  - `descriptionHtml`: the `text` of sections `companyDescription`, `jobDescription`, `qualifications` and `additionalInformation` (in that order, skipping missing ones), joined with `"\n"`
  - `postedAt`: `toIsoUtc(releasedDate)`
  - location texts: `[location.fullLocation ?? ""]`
  - structured workplace type: as in the pre-filter
- **Probe:** `GET .../postings?limit=10`. `totalFound === 0` → `exists: false` (SmartRecruiters can't tell "unknown" from "empty"). Otherwise `companyName = content[0].company.name`, and `urls` are built as `https://jobs.smartrecruiters.com/<slug>/<id>`.
- **Fixtures:**
  - `postings-page.json`: `BoschGroup` with `limit=3`. Set `totalFound` to 3 in the trimmed copy so pagination stops.
  - `posting-<id>.json`: the detail of every posting in the page.
  - `postings-tech.json`: a hand-edited copy of the page where one posting's `name` is changed to `"Senior Full-Stack Engineer"`, `location.remote` to `true` and `location.fullLocation` to `"Remote - LATAM"`. This tests that only that one gets a detail request.
- **Extra tests:**
  - `pre-filter skips detail requests for non-matching postings` (assert `http.calls`)
  - `paginates until totalFound`
  - `probe totalFound 0 → exists false`
- **After this task:** the `registry.test.ts` "covers SOURCE_IDS exactly" check is restored.
- Commit type: `feat`.
- [ ] Done

---

### Part E: Resolution and seeding

### T17: Identity check and resolver (`src/companies/resolve.ts`, depends on T7, T16)
- **Interfaces:**
  ```ts
  export type Candidate = { name: string; website: string | null; careersUrl: string | null; atsHints: string[] };
  export const PROBE_ORDER: readonly AtsId[] = ["greenhouse","lever","ashby","workable","recruitee","smartrecruiters"];
  export function proveIdentity(candidate: Candidate, ats: AtsId, probe: ProbeResult): boolean;
  export async function resolveCandidate(http: HttpClient, candidate: Candidate, probes: Record<AtsId, ProbeFn>): Promise<Resolution>;
  ```
- **`proveIdentity`:** true if **any** of these holds:
  1. `probe.companyName` isn't null and `normalizeCompany(probe.companyName) === normalizeCompany(candidate.name)`.
  2. `d = websiteDomain(candidate.website)` isn't null, and some `probe.urls` hostname equals `d` or ends with `"." + d`, or some `probe.texts` contains `d` (case-insensitive).
  3. `ats` is `lever` or `ashby`, `probe.texts.length >= 1`, and the number of texts containing the candidate name (case-insensitive, whole-word, `(?<![\p{L}\p{N}])<name>(?![\p{L}\p{N}])`) is `>= min(2, probe.texts.length)`.
- **`resolveCandidate` algorithm** (no DB access; pure apart from `http`):
  1. **Direct refs:** `extractAtsRefs` over `[candidate.careersUrl, candidate.website, ...candidate.atsHints]` (skip nulls), unique, in order. For each ref: `probe = probes[ref.ats](http, ref.slug)`. If `probe.exists` and (`ref.ats !== "smartrecruiters"` or `probe.postingCount > 0`), return `{ status: "confirmed", ats, slug, companyName: probe.companyName }`. A direct link from the company's own data or posting **is** the identity proof.
  2. **Guesses:** for each `slug` in `slugGuesses(candidate.name, candidate.website)`, then for each `ats` in `PROBE_ORDER`, skipping (ats, slug) pairs already probed in step 1:
     - `probe.exists` false → continue.
     - `proveIdentity` true → return `confirmed` immediately.
     - Otherwise, if `probe.postingCount > 0` or `probe.companyName !== null`, record `{ ats, slug }` as an unproven match.
     - Otherwise (an empty board with no name) → continue.
  3. **Errors:** if any probe threw (non-404), remember the first error message and continue with the remaining probes.
  4. **Result:**
     - unproven matches → `{ status: "ambiguous", matches }`
     - else, if an error happened → `{ status: "error", error }`
     - else `{ status: "not_found" }`
- **Probe registry:** `atsProbes` in `registry.ts` (shared rules). Each probe catches only `HttpError` 404 itself.
- **Tests first** (`resolve.test.ts`, with `createFixtureHttp(routes, { fallbackStatus: 404 })` and **hand-written** fixtures in `test/fixtures/resolve/`). Each test also asserts `http.calls` exactly.
  - `direct careers_url link confirms after an existence check`: careersUrl `https://boards.greenhouse.io/acme` + the board fixture `{ "name": "Something Else" }` → confirmed greenhouse/acme.
  - `name match confirms on greenhouse`: "Acme Inc" + board `{ "name": "ACME" }` → confirmed.
  - `lever confirmed by name in 2 postings`.
  - `lever with a single posting confirmed by name in it`.
  - `domain match confirms`: Recruitee `careers_url` `https://careers.globex.com/o/1` + website `globex.com` → confirmed.
  - `unproven match → ambiguous with matches`.
  - `empty lever board → not_found`.
  - `smartrecruiters totalFound 0 → not_found`.
  - `500 error on one probe and nothing else → error`.
  - `stops at first confirmed`: no calls after the confirming one.
  - `skips pairs already probed via direct refs`.
- Verify: `npm test -- src/companies/resolve.test.ts` passes.
- Commit type: `feat`.
- [ ] Done

### T18: Resolution runner (`src/companies/resolve-runner.ts`, depends on T9, T17)
- **Interface:**
  ```ts
  export type ResolutionStats = { checked: number; confirmed: number; ambiguous: number; notFound: number; errors: number; byOrigin: Record<string, { checked: number; confirmed: number }> };
  export async function resolveDueCandidates(opts: { db: Db; http: HttpClient; probes: Record<AtsId, ProbeFn>; now: () => Date; limit?: number; concurrency?: number; log?: (m: string) => void }): Promise<ResolutionStats>;
  ```
- **Behavior:**
  - `concurrency` defaults to 6. Pass a **paced** client (T8) from the caller; this function doesn't create one.
  - Load the due candidates with `listDueCandidates(db, now, limit)`, then resolve them with at most `concurrency` in flight, using a small queue like `runner.ts`.
  - Write each result with `recordResolution` **as soon as it finishes**, so an interrupted run is resumable.
  - Every 25 candidates, log `resolve: <done>/<total> (confirmed <n>, ambiguous <n>, not found <n>, errors <n>)`.
  - A thrown error for one candidate (unexpected, not a probe error) → record `{ status: "error", error: "<name>: <message>" }` and continue. Never reject.
- **Tests first:** in-memory DB plus fixture HTTP.
  - `resolves due candidates and writes results`
  - `respects limit`
  - `skips candidates not due`
  - `byOrigin counts`
  - `a thrown candidate becomes error and others continue`
- Verify: `npm test -- src/companies` passes.
- Commit type: `feat`.
- [ ] Done

### T19: Seed sources (`src/companies/seeds.ts`, depends on T4, T5, T9)
- **Interfaces:**
  ```ts
  export const REMOTEINTECH_TREE_URL = "https://api.github.com/repos/remoteintech/remote-jobs/git/trees/main?recursive=1";
  export const REMOTEINTECH_RAW_BASE = "https://raw.githubusercontent.com/remoteintech/remote-jobs/main/";
  export const YC_ALL_URL = "https://yc-oss.github.io/api/companies/all.json";
  export function parseFrontMatter(markdown: string): Record<string, string>;
  export async function fetchRemoteintechCandidates(http: HttpClient, log?: (m: string) => void): Promise<CandidateInput[]>;
  export function ycCandidatesFrom(json: unknown): { kept: CandidateInput[]; skipped: { notActive: number; notHiring: number; homeCountry: number } };
  export async function fetchYcCandidates(http: HttpClient): Promise<ReturnType<typeof ycCandidatesFrom>>;
  ```
- **`parseFrontMatter`:**
  - Requires the text to start with `---\n`; the block ends at the next line that is exactly `---`.
  - For each line with **no leading whitespace** matching `^([A-Za-z0-9_]+):\s*(.*)$`, take key → value with surrounding single or double quotes removed. Ignore all other lines (lists, nested values).
  - No front matter → `{}`.
- **`fetchRemoteintechCandidates`:**
  1. `getJson(TREE_URL)` → `{ tree: { path: string, type: string }[], truncated: boolean }`. If `truncated` is true, log a warning.
  2. Keep `type === "blob"` and paths matching `^src/companies/[^/]+\.md$`.
  3. For each path, `getText(RAW_BASE + path)`, all at once; the paced client limits the rate.
  4. Front matter: `title` → name (skip if missing), `website`, `careers_url` → `careersUrl`. `origin: "seed:remoteintech"`, `homeCountry: null`.
  5. A failing file is logged and skipped; it doesn't fail the seed.
- **`ycCandidatesFrom`:** validate with Zod as an array of `{ name: string, website?: string|null, status?: string|null, isHiring?: boolean|null, all_locations?: string|null }`, with passthrough.
  - `status !== "Active"` → `notActive++`.
  - `isHiring !== true` → `notHiring++`.
  - Home country: first location = `all_locations` split on `;`, first part, trimmed. Last token = that location split on `,`, last part, trimmed. `homeCountry = countryCodeFromName(lastToken)`.
  - If `homeCountry` isn't null and `!isAllowedHomeCountry(homeCountry)` → skipped as `homeCountry++`.
  - Otherwise kept: `{ name, website, careersUrl: null, homeCountry, origin: "seed:yc" }`. An unknown home country (`null`) is kept.
- **Tests first** (`seeds.test.ts`, hand-written fixtures in `test/fixtures/seed/`, **never** real YC records):
  - `parseFrontMatter`: quoted values, nested lists ignored, no front matter → `{}`.
  - `fetches tree then raw files` (assert `http.calls`).
  - `skips files without title`.
  - `logs and skips a failing file`.
  - `yc filter counts`, using a 6-record fixture:
    | name | status | isHiring | all_locations | expected |
    |---|---|---|---|---|
    | Initech | Active | true | San Francisco, CA, USA | kept, US |
    | Hooli | Active | false | | notHiring |
    | Vandelay | Active | true | Buenos Aires, Argentina | homeCountry |
    | Globodyne | Inactive | true | | notActive |
    | Umbrella | Active | true | London, England, United Kingdom; Paris, France | kept, GB |
    | Massive Dynamic | Active | true | (none) | kept, null |
- Verify: `npm test -- src/companies/seeds.test.ts` passes.
- Commit type: `feat`.
- [ ] Done

### T20: `npm run seed` (`src/scripts/seed-cli.ts` + `src/scripts/seed.ts`, depends on T8, T18, T19)
- **Pattern:** the same as `fetch-cli.ts`/`fetch.ts`. A testable `runSeedCli(argv, deps)` returns an exit code; `seed.ts` is thin process wiring. Add `"seed": "tsx src/scripts/seed.ts"` to `package.json`, and add `src/scripts/seed.ts` to `coverage.exclude` in `vitest.config.mts` (wiring only, like `fetch.ts`).
- **Flags:**
  - `--limit <n>`: resolve at most n candidates
  - `--no-resolve`: only load candidates
  - `--only remoteintech|yc`
  - Unknown flags → `CliUsageError` (reuse it from `fetch-cli.ts`).
- **Steps:**
  1. `http = createPacedHttpClient(deps.http, { minIntervalMs: 500, perHostMinIntervalMs: { "raw.githubusercontent.com": 100 } })`.
  2. Fetch the selected seed sources and `upsertCandidate` each one. Count `inserted`/`updated`/`unchanged` per origin.
  3. Unless `--no-resolve`, run `resolveDueCandidates({ ..., limit })`.
  4. Print:
     - `out.table` of candidates per origin (`origin`, `inserted`, `updated`, `unchanged`)
     - the YC skip counts
     - `out.table` of resolution `byOrigin` (`origin`, `checked`, `confirmed`, `rate %`)
     - `Companies: <active> active (<byAts>)`
  5. Exit 0 if at least one seed source loaded, otherwise 1. Seed source errors are printed with `out.error` and the other source continues.
- **Tests first** (`seed-cli.test.ts`, fixture HTTP + in-memory DB, with the `test/fixtures/seed/` and `test/fixtures/resolve/` fixtures):
  - `loads both sources and resolves`
  - `--no-resolve only loads`
  - `--only yc`
  - `--limit`
  - `unknown flag → 1`
  - `a failing source still loads the other`
- Verify: `npm test -- src/scripts` passes, and `npm run seed -- --bogus` prints `Unknown option: --bogus` and exits 1 (no network).
- Commit type: `feat`.
- [ ] Done

### T21: `npm run company` (`src/scripts/company-cli.ts` + `company.ts`, depends on T9, T17)
- **Pattern:** the same as `seed`. Add `"company": "tsx src/scripts/company.ts"` to `package.json`, and add `src/scripts/company.ts` to `coverage.exclude`.
- **Subcommands:**
  - **`add <ats> <slug> [--name <name>] [--country <ISO2>]`:**
    - Validate `ats` is in `ATS_IDS` and the country matches `^[A-Z]{2}$`.
    - Probe; `exists` false → `out.error("No <ats> board found for <slug>")`, exit 1.
    - Otherwise `insertOrGetCompany` with name = `--name ?? probe.companyName ?? slug`, `origin: "manual"`. If the company exists, update its `name`/`homeCountry` when given, and set `status: "active"`, `consecutiveFailures: 0`.
    - Also `upsertCandidate` + `recordResolution(confirmed)`, so the candidate links to it.
    - Print `Added <ats>/<slug> (<name>)`.
  - **`review`:** `out.table` of ambiguous candidates (`id`, `name`, `origin`, `website`, `matches`, where `matches` is `"ats/slug, ..."`). If there are none, print `No ambiguous companies.`.
  - **`confirm <candidateId> <ats> <slug>`:** the candidate must exist and be `ambiguous`. Probe; it must exist. `recordResolution(confirmed)`. Print `Confirmed <name> → <ats>/<slug>`.
  - **`reject <candidateId>`:** `recordResolution({ status: "not_found" })` and clear `ambiguousMatches`. Print `Rejected <name>`.
  - **`sample <n>`:** print `n` random **active** companies as `name | ats | slug | board URL`, where the board URL is the human page for that ATS:
    - `https://boards.greenhouse.io/<slug>`
    - `https://jobs.lever.co/<slug>`
    - `https://jobs.ashbyhq.com/<slug>`
    - `https://apply.workable.com/<slug>`
    - `https://<slug>.recruitee.com`
    - `https://jobs.smartrecruiters.com/<slug>`

    This is the M2 precision spot-check.
- **Errors:** an unknown subcommand or bad arguments → `CliUsageError` with a usage line, exit 1.
- **Tests first** (`company-cli.test.ts`):
  - `add confirms and links`
  - `add unknown board → 1`
  - `add invalid country → 1`
  - `review lists ambiguous`
  - `confirm`
  - `reject sets next check`
  - `sample prints n rows with board urls`
  - `usage error → 1`
- Commit type: `feat`.
- [ ] Done

---

### Part F: Fetch pipeline

### T22: Boards become discovery-only (`src/sources/runner.ts`, `src/db/*`, depends on T7, T9)
- **Changes:**
  1. **All 7 board adapters:** `techFilter: true`.
  2. **`fetch_runs`:** add `latestPostedAt: text("latest_posted_at")` (new migration via `npm run db:generate`).
  3. **`latestPostedAt(db, source)`:**
     - For **board** ids: return `max(fetch_runs.latest_posted_at)` where `source = id` and `status = "success"`.
     - For ATS ids: keep the old query on `jobs`, which is unused.
  4. **`runSources`** (it now runs boards only):
     - After a successful `runAdapter`, call `recordCandidatesFromBoardJobs(db, adapter.id, jobs, nowIso)` instead of `upsertJobs`. It lives in `src/companies/discover.ts`.
     - For each job: `upsertCandidate({ name: job.company, atsHints: extractAtsRefs([job.url, job.applyUrl ?? "", job.descriptionHtml].join(" ")).map(r => <canonical URL of r>), origin: "board:<id>" })`.
     - The canonical hint URL is the `sample` board URL format from T21; export one `boardUrl(ref)` from `slugs.ts` and use it in both places.
     - The summary's `inserted` is the number of `"inserted"` candidates; `updated` is `"updated"` + `"unchanged"`.
     - Record the run with `latestPostedAt` = the max `postedAt` of the fetched jobs (`null` if none).
  5. **No board job is ever written to `jobs`:** add a guard at the top of `upsertJobs` that throws `Error("upsertJobs: board jobs are not stored (<source>)")` if any item's source is in `BOARD_IDS`.
- **Expected numbers** (computed from the committed fixtures on 2026-11-16; stop and report if they differ):
  - The 7 boards produce **10** candidates: `silverdev`, `rainfocus`, `salvosoftware`, `alloy`, `airbnb`, `lithic`, `blackbirdcollective`, `notabene`, `proxify`, `quantumsystems`.
  - Per board (fetched / inserted / filtered):
    | board | fetched | inserted | filtered |
    |---|---|---|---|
    | remoteok | 4 | 3 | 1 |
    | weworkremotely | 15 | 3 | 0 |
    | remotive | 3 | 0 | 3 |
    | himalayas | 3 | 1 | 2 |
    | jobicy | 3 | 1 | 2 |
    | workingnomads | 3 | 1 | 2 |
    | arbeitnow | 3 | 1 | 2 |

    Note that both workingnomads jobs from Proxify collapse into one candidate.
  - A forced second run: every `inserted` is 0, and `updated` is 3, 3, 0, 1, 1, 1, 1.
- **Tests:**
  - Update `runner.test.ts`: the fake adapters' jobs become candidates; assert the `company_candidates` rows and that `jobs` stays empty.
  - Update `fetch-cli.integration.test.ts` to the numbers above. It now asserts `company_candidates` count 10 and `jobs` count 0, plus the existing skip and force tests.
  - New in `discover.test.ts`:
    - `adds ats hints from urls and description`
    - `records latestPostedAt on the run`
    - `himalayas stops at the recorded latestPostedAt` (two runs)
  - New in `queries.test.ts`: `upsertJobs refuses board jobs`.
- Verify: `npm test` passes.
- Commit type: `feat`.
- [ ] Done

### T23: ATS runner (`src/sources/ats-runner.ts`, depends on T5, T6, T9, T10, T16, T22)
- **Interface:**
  ```ts
  export type AtsRunSummary = { source: AtsId; status: "success" | "error" | "skipped"; companies: number; companiesFailed: number; fetched: number; inserted: number; updated: number; invalid: number; filteredTech: number; filteredLocation: number; closed: number; error: string | null; durationMs: number };
  export async function runAtsSources(opts: { db: Db; http: HttpClient; adapters: AnyAdapter[]; force?: boolean; now?: () => Date; log?: (m: string) => void }): Promise<AtsRunSummary[]>;
  ```
- **Behavior:**
  - `http` must already be paced (the CLI does it).
  - **All ATS adapters run in parallel**, one `Promise.all` over adapters; the paced client handles hosts. Within one ATS, companies run **sequentially**.
  - **Per ATS:** `companies = listDueCompanies(db, id, nowIso, { force })`. If empty → `status: "skipped"` and `recordRun` skipped.
  - **Per company:**
    1. `result = await runAdapter(adapter, { http, latestPostedAt: null, log, companies: [ref] })`, where `ref` is built from the company row.
    2. **If `result.status === "error"`:**
       - If the error text starts with `"HttpError: HTTP 404"` → `recordCompanyFetch(not_found)`; otherwise `recordCompanyFetch(error)`.
       - `companiesFailed++`.
       - Never call `markClosedJobs` for a failed company.
    3. **Otherwise:**
       - `seen = result.jobs`, which are all valid jobs, since the ATS `techFilter` is false.
       - Then for each job: if `!isTechJob(job)`, `filteredTech++`. Else `v = checkLocation(job, company.homeCountry)`; if `!v.pass`, `filteredLocation++`. Else keep it.
       - `upsertJobs(db, kept, nowIso, { companyId })`.
       - `closed += markClosedJobs(db, companyId, seen.map(j => j.externalId), nowIso)`.
       - `recordCompanyFetch(success)`.
       - Add to `fetched`, `invalid`, `inserted` and `updated`.
    4. **Wrap the company step in `try/catch`.** An unexpected throw (e.g. a DB error) → `recordCompanyFetch(error)` inside its own `try` (log if that fails too), `companiesFailed++`, and continue. One company never stops its ATS, and one ATS never stops the others.
  - **Per ATS status:** `success` if at least one company succeeded; `error` if all failed. Record one `recordRun` per ATS with `fetched`, `inserted`, `updated`, `invalid`, `filtered = filteredTech + filteredLocation`, and `error` = the first company error or `null`.
  - **Log** one line per company: `<ats>/<slug>: kept <n>, filtered <t>+<l>, closed <c>` or `<ats>/<slug>: <error>`.
- **Tests first** (`ats-runner.test.ts`, in-memory DB + fixture HTTP + fake ATS adapters defined in the test, **plus** one test with the real `greenhouse` adapter and its fixture):
  - `stores only jobs passing both filters with companyId`
  - `closes jobs missing from the next fetch`
  - `404 three times deactivates the company`
  - `non-404 error keeps company due`
  - `failed company never closes jobs`
  - `skipped when no due companies`
  - `one ats failing does not stop others`
  - `force refetches companies fetched recently`
- Verify: `npm test -- src/sources` passes.
- Commit type: `feat`.
- [ ] Done

### T24: Fetch CLI orchestration (`src/scripts/fetch-cli.ts`, depends on T18, T22, T23)
- **`CliDeps` changes:**
  - `adapters` is replaced by `boardAdapters` and `atsAdapters`.
  - Add `probes`.
  - Add an optional `resolveLimit` (default 50).
  - Keep `openDb`, `http`, `now` and `out`.
- **Flags:**
  - `--source` accepts board **and** ATS ids; the unknown-source message lists all 13 in registry order.
  - `--force` (ignore board intervals and the daily company limit).
  - New `--skip-resolve`.
- **Steps:**
  1. Parse and validate the arguments; `openDb` only afterwards (unchanged behavior).
  2. `paced = createPacedHttpClient(deps.http)` (default 500 ms).
  3. **Boards:** `runSources` with the selected board adapters (none if only ATS ids were given). The unpaced `deps.http` is fine here, since boards are single endpoints with their own intervals.
  4. **Resolution:** unless `--skip-resolve`, or `--source` was given, `resolveDueCandidates({ http: paced, limit: resolveLimit })`.
  5. **ATS:** `runAtsSources({ http: paced, adapters: selected ATS })`.
  6. **Purge:** `purgeClosedJobs(db, nowIso)`.
  7. **Output:**
     - `out.table` boards (the existing `SummaryRow`)
     - `out.log("Resolution: checked <n>, confirmed <n>, ambiguous <n>, not found <n>, errors <n>")` (or `Resolution: skipped`)
     - `out.table` ATS rows (`source`, `status`, `companies`, `failed`, `fetched`, `inserted`, `updated`, `invalid`, `filteredTech`, `filteredLocation`, `closed`, `ms`, `error`)
     - `out.log("Purged <n> closed jobs")`
     - `out.log("Open jobs in DB: <countJobs openOnly>")`
     - `out.log("Active companies: <n>")`
- **Exit code:** 0 if any board or ATS row is `success` or `skipped`, otherwise 1.
- **`fetch.ts`:** wire the new deps from the registry. It still only wires the process.
- **Tests first:** update the `fetch-cli.test.ts` parsing and validation tests (13 ids, `--skip-resolve`). The integration test is rewritten in T25.
- Verify: `npm test -- src/scripts/fetch-cli.test.ts` passes, and `npm run fetch -- --source nope` prints the 13-id message and exits 1.
- Commit type: `feat`.
- [ ] Done

### T25: Offline end-to-end test of seed + fetch (`src/scripts/m2.integration.test.ts`, depends on T20, T24)
- **Hand-written fixtures** in `test/fixtures/integration/`, routed through `createFixtureHttp(routes, { fallbackStatus: 404 })`. All other probe URLs 404 via the fallback.
  - **Seed tree:** `tree.json` with 2 blobs: `src/companies/acme.md` and `src/companies/globex.md`.
  - **`acme.md`:** `title: Acme`, `website: https://acme.io`, `careers_url: https://boards.greenhouse.io/acme`.
  - **`globex.md`:** `title: Globex`, `website: https://globex.com` (no careers URL).
  - **`yc.json`:** 2 records: `Initech` (Active, hiring, `"San Francisco, CA, USA"`, website `https://initech.com`) and `Vandelay` (Active, hiring, `"Buenos Aires, Argentina"`, which is skipped).
  - **Greenhouse `acme`:**
    - board → `{ "name": "Acme" }`
    - jobs with 3 items:
      - id 1 `"Senior Full-Stack Engineer"`, location `"Remote - LATAM"` → **stored**
      - id 2 `"Account Executive"`, location `"Remote"` → filtered (tech)
      - id 3 `"Frontend Engineer"`, location `"San Francisco, CA"` → filtered (location: onsite)
  - **Lever `globex`:** 2 postings, both with `descriptionPlain` containing "Globex":
    - `"Backend Developer (Node.js)"`, `workplaceType: "remote"`, `categories.location: "Remote"` → **stored**
    - `"React Developer"`, `workplaceType: "remote"`, `categories.location: "United States"` → filtered (location: region)
  - **Ashby `initech`:** 1 job whose `descriptionPlain` does **not** mention Initech or `initech.com` → **ambiguous**.
  - **Boards:** reuse `ALL_SOURCE_ROUTES` (the 7 boards), which gives 10 board candidates, none resolving (all fallback 404).
- **Scenario** (one test per step, sharing one in-memory DB, with the clock starting at `2026-11-16T12:00:00.000Z`):
  1. **`seed`:** candidates are `Acme` and `Globex` (`seed:remoteintech`) and `Initech` (`seed:yc`), with YC skips `{ homeCountry: 1 }`. Resolution: Acme confirmed `greenhouse/acme` (direct link), Globex confirmed `lever/globex`, Initech ambiguous `[ashby/initech]`. Companies: 2 active.
  2. **`fetch` (first run):**
     - Boards add 10 candidates. Resolution checks those 10; all are `not_found`.
     - ATS rows:
       - greenhouse: companies 1, fetched 3, inserted 1, filteredTech 1, filteredLocation 1
       - lever: companies 1, fetched 2, inserted 1, filteredLocation 1
       - others: `skipped`
     - `Open jobs in DB: 2`. Exit code 0.
  3. **`fetch` again at the same time:** ATS rows are all `skipped` (fetched today), and the boards are skipped by their intervals.
  4. **Closure:** advance the clock 21 hours and swap Acme's jobs route to a variant **without** id 1. `fetch` → greenhouse `closed: 1`, `Open jobs in DB: 1`.
  5. **Purge:** advance the clock 31 days; `fetch` (with the same routes) → `Purged 1 closed jobs`.
  6. **`company review`:** lists Initech with `ashby/initech`. **`company confirm <id> ashby initech`** → `Active companies: 3` on the next `fetch` summary. Add a route for `https://api.ashbyhq.com/posting-api/job-board/initech?includeCompensation=true` serving the same Ashby fixture, so that fetch succeeds.
- Verify: `npm test -- src/scripts/m2.integration.test.ts` passes, and the full `npm test` passes. **Delete** the old `fetch-cli.integration.test.ts` only if it's fully covered by this test plus T22's updated version; otherwise keep both.
- Commit type: `test`.
- [ ] Done

### T26: Live checks (depends on T16, T19)
- **`adapters.live.test.ts`:** the 6 ATS checks (shared rules) plus:
  - `remoteintech tree lists more than 500 company files`
  - `yc dataset has more than 1000 active companies`
  - `probe confirms verified slugs`: for each verified slug, `resolveCandidate` with candidate name Mozilla/Curai/LiveKit/Modash/Tether/Bosch Group and `careersUrl` = its board URL → `confirmed`
- **Run `npm run test:live` once.** If a source fails because its API changed, stop and report; don't loosen the assertions.
- Commit type: `test`.
- [ ] Done

### T27: Real run and M2 acceptance (depends on T25, T26)
- **Steps** (real network; long-running, so run in the background and watch the progress lines):
  1. `rm -f data/jobs.db*`.
  2. `npm run seed`. This takes roughly 30–60 minutes. Progress prints every 25 candidates. If it's interrupted, run it again: resolution resumes.
  3. `npm run fetch`.
  4. `npm run company -- sample 20`. Paste the 20 rows into the report for the **user** to spot-check: the target is at least 19 correct. Don't judge them yourself.
  5. Record:
     - candidates per origin and the confirmed rate per origin (from the seed output)
     - `Active companies`, broken down by ATS
     - `Open jobs in DB`
     - the ATS table
- **Acceptance:** at least 300 confirmed active companies **and** at least 200 open jobs.
  - If either is below target, **don't change filters or thresholds**. Report the numbers and stop.
  - Also report the count from `npm run company -- review` (ambiguous candidates).
- No code changes. If the run exposes a bug, fix it in a separate `fix(m2): ...` commit with a failing test first.
- [ ] Done

### T28: Wrap-up (depends on T27)
- **`CLAUDE.md` commands:**
  - Move `seed` and `company` from "Planned" to the real list, documenting `npm run seed [-- --limit N | --no-resolve | --only yc|remoteintech]` and `npm run company -- add|review|confirm|reject|sample`.
  - Add `--skip-resolve` to `fetch`.
  - Make no other `CLAUDE.md` edits.
- **`PLAN.md`:**
  - Mark M2 `(done)` and M3 `(current)`.
  - Add `Detailed spec: [docs/plans/m2-companies-ats.md](...)` if it's missing.
  - Append to the decisions log, with the real numbers from T27: `- <date>: M2 done: <n> active companies (<byAts>), <n> open jobs; resolution rate <x>% remoteintech / <y>% yc; <n> ambiguous awaiting review.`
- Verify: the milestone verification below passes.
- Commit type: `docs`.
- [ ] Done

## Milestone verification
1. `nvm use && npm run lint && npm run typecheck && npm test && npm run test:coverage` all pass, including the coverage thresholds.
2. `grep -rn "vi.mock" src/` prints nothing. `grep -rn "expect.any\|expect.anything\|arrayContaining" src/sources/` prints nothing.
3. `npm run fetch -- --source nope; echo $?` prints the 13-id message, then `1`. No network is used.
4. T27's numbers meet the acceptance targets, or are reported with the reason.
5. `git log --oneline main..` shows one commit per task.

## Gotchas
- **Lever `createdAt` is in milliseconds.** `toIsoUtc` treats numbers as seconds, so divide by 1000 first.
- **Recruitee dates** look like `"2026-11-16 16:33:49 UTC"`. If `toIsoUtc` returns `null` for that format, convert it in the adapter (`replace(" UTC","Z").replace(" ","T")`); don't change `toIsoUtc`'s contract without a test.
- **SmartRecruiters slugs are case-sensitive** (`BoschGroup`). `slugGuesses` only produces lowercase, so most SmartRecruiters companies will come from direct links. That's accepted.
- **Greenhouse `content` is HTML-escaped once.** Decode it with `decodeEntities` before `htmlToText`.
- **Never close jobs for a company whose fetch failed.** A network blip must not close everything.
- **`purgeClosedJobs` must clear `duplicate_of` pointers** before deleting, or the foreign key fails.
- **Whole-word matching for `US`/`EU`** must not match inside words ("customer", "museum"). The T4 tests cover this; keep them.
- **"North America" must never produce `americas`.** Remove matched phrase spans before matching the rest.
- **Board jobs are never stored.** The `upsertJobs` guard (T22) makes any regression throw in tests.
- **The paced client serializes per host.** Don't add a second concurrency limit inside adapters. Also don't pass the paced client into `runSources` (boards), or the whole fetch slows down.
- **Seeding is long and resumable** (results are written per candidate). Never wrap the whole seed in one transaction.
- **Don't commit real YC records** (no license). Fixtures for YC are hand-written. Recorded ATS fixtures and `remoteintech` content are fine.
- **Never edit generated `drizzle/` files.** T2 deletes and regenerates the folder (approved, one time only); T3 and T22 add migrations with `npm run db:generate`.

## Open questions / assumptions
- **Resolution time (assumption):** about 1,370 YC + about 880 `remoteintech` candidates × up to 18 probes, paced at 2 requests/second per host across 6 hosts, gives a first seed of roughly 30–60 minutes. If it's much slower, report it rather than raising the request rate.
- **SmartRecruiters coverage will be low** (case-sensitive slugs; mostly direct links). Accepted for M2.
- **No ambiguous-match volume target:** the user reviews them with `npm run company -- review`. If there are more than 200 after the first seed, report the number.
- **Stop and ask** if any approved interface change turns out to be insufficient (e.g. an adapter needs data that `FetchContext.companies` can't carry).
