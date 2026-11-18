# Job Searcher MVP Plan

## Goal
A personal tool that finds the IT jobs that best fit one specific search. It builds a list of tech companies, fetches their open roles straight from their ATS (the hiring system each company uses), filters and ranks the jobs against my search with local embeddings, and has Claude score only the top matches, once per job. Done = `npm run seed` builds the company list (monthly), `npm run fetch` discovers new companies and refreshes their jobs (daily), and a local UI shows my best jobs with Claude's score and reasons and lets me get the next batch.

## Scope
- In:
  - company list seeded from `remoteintech/remote-jobs` and the YC company dataset, plus companies I add by hand
  - job boards (from M1) used **only to discover companies**; board jobs are never stored
  - jobs fetched from 5 ATSs: Greenhouse, Lever, Ashby, Recruitee, SmartRecruiters
  - storage filters: only tech jobs matching my stack keywords, remote, doable from Argentina, at companies based in the USA, Canada, Europe, Australia or New Zealand (or of unknown origin), are stored
  - one search description in its own file (`config/search.md`) plus hard rules (`config/preferences.json`)
  - filters, then local embedding ranking, then Claude scoring of the top N; each job scored once; "get next"
  - saving or dismissing jobs in the UI (no learning from these decisions)
  - local UI
- Out (for now):
  - HN "Who is hiring?" (not needed for discovery)
  - Get on Board (its companies are mostly LATAM-based, which the location filter excludes)
  - storing or showing board jobs
  - learning or training from approve/reject decisions
  - more than one search description
  - matching against my CV (maybe later)
  - re-scoring jobs
  - other ATSs (Workday, Personio, Teamtailor, BambooHR, ...)
  - paid services other than the Anthropic API (Claude)
  - fetching company websites or careers pages (only URLs we already have are parsed)
  - hosting or a public demo, auth and multiple users
  - LinkedIn and Wellfound (I handle those manually)
  - scraping

## Stack & key decisions
- TypeScript + Next.js (App Router): a stack I already know; UI and code in one project.
- SQLite + Drizzle: a local file with typed queries. A single user doesn't need a database server.
- Zod: external APIs change shape, so every response is validated.
- Vitest: tests run against recorded API responses, so they work offline and give the same result every time.
- Transformers.js (`@huggingface/transformers`): local, free embeddings in Node. Multilingual model, because some jobs are in Spanish or German.
- Anthropic API (Claude): the only paid service. Scores only the top-ranked jobs, each job once.
- Hosting: none. It runs locally.

## Pipeline
1. **Companies:** seed lists + board discovery + manual adds → candidates → precise slug resolution → confirmed companies.
2. **Jobs:** fetch each active company's ATS board about once a day; store only jobs that pass the storage filters (tech filter + location filter); mark jobs that disappeared as closed.
3. **Filter:** hard rules from `config/preferences.json` (seniority, salary floor, department). Unknown values pass.
4. **Rank:** embed each open job once; rank by similarity to `config/search.md`.
5. **Score:** Claude scores the top N (default 100) once each, with reasons; "get next" scores the next page on demand.

## Milestones
### M1: Direct job board APIs (done)
Detailed spec: [docs/plans/m1-board-apis.md](docs/plans/m1-board-apis.md)

- [x] Scaffold: Next.js + TS strict, ESLint, Vitest, tsx, and the npm scripts listed in CLAUDE.md. The DB file goes in `data/` (gitignored).
- [x] `Job` Zod schema + `SourceAdapter` interface
- [x] Shared HTTP helper (timeout, retry, User-Agent)
- [x] DB: `jobs` and `fetch_runs` tables; upsert on (source, externalId)
- [x] Fetch runner + `npm run fetch` CLI: errors isolated per source, summary per source
- [x] Remote OK adapter + fixture tests (first end-to-end slice)
- [x] We Work Remotely adapter (RSS)
- [x] Get on Board adapter
- [x] Remotive adapter
- [x] Himalayas adapter (incremental: stop at the newest stored posting date)
- [x] Jobicy adapter
- [x] Working Nomads adapter
- [x] Arbeitnow adapter (keep IT roles only)
- [x] HN "Who is hiring?" adapter (latest thread; free-text posts)
- [x] Dedupe across sources (same apply URL, or same company + title; marked, not deleted)
- [x] One live check per adapter (`npm run test:live`)

Verify: `npm test`, lint, and typecheck pass. `npm run test:live` gets jobs from every source. Running `npm run fetch` twice adds only new jobs on the second run.

### M1.1: Bug fixes and test hardening (done)
Detailed spec: [docs/plans/m1.1-test-hardening.md](docs/plans/m1.1-test-hardening.md)

- [x] Fix 5 known bugs test-first, make adapter tests exact, extract the CLI and add an offline integration test, close small test gaps, and optionally add a coverage report.

Verify: lint, typecheck and `npm test` pass; no loose matchers in adapter tests; no `vi.mock` in `src/`.

### M2: Companies + ATS sources (done)
Detailed spec: [docs/plans/m2-companies-ats.md](docs/plans/m2-companies-ats.md)
Review fixes: [docs/plans/m2.1-review-fixes.md](docs/plans/m2.1-review-fixes.md)
Second review fixes: [docs/plans/m2.2-review-fixes.md](docs/plans/m2.2-review-fixes.md)

Build the company list, resolve each company to its ATS precisely, and fetch jobs only from ATSs.

- **Schema update** (approved 2026-11-16). Since M2 starts from a fresh DB, the migration is rewritten rather than layered on M1's board-shaped data.
  - `Job` changes:
    1. `remote: boolean | null` becomes `workplaceType: "remote" | "hybrid" | "onsite" | null`.
    2. Add `departments: string[]`: Greenhouse `departments`, Lever `team`/`department`, Ashby `department` + `team`, Recruitee `department`, SmartRecruiters `department` / `function`.
    3. Add `regions: string[]` (our own vocabulary, derived only from the job's location text; see "Location filter"). `location` stays as display text. There's no `countries` field: an ATS's structured country is often the office country, not where the job can be done from.
    4. Add `employmentType: string | null` (full-time, contract, ...).
    5. `externalId` becomes `<slug>:<ATS job id>`, unique per company, because ATS job ids are only unique within an account.
    6. `SOURCE_IDS` gains the 5 ATS ids, and only ATS jobs are accepted for storage.
  - `FetchContext` change: ATS adapters receive their list of active companies.
  - DB:
    - `jobs` gains `companyId` (linked to `companies`) and `closedAt`.
    - New tables `companies` and `company_candidates` (below).
    - Later, separate tables `job_embeddings` (M3) and `job_scores` (M4), so `jobs` stays lean.
- **ATS quirks** found on 2026-11-16:
  - Greenhouse needs `?content=true` for descriptions, and its HTML comes escaped.
  - Ashby needs `?includeCompensation=true` for salary.
  - SmartRecruiters' list has no full description. Apply the storage filters to title, department and location first, and fetch the posting details only for jobs that pass.
  - SmartRecruiters' `ref` is an API URL, so the page link is built as `https://jobs.smartrecruiters.com/<company>/<id>`.
  - Structured salary exists only on Recruitee `salary`, Ashby `compensation` and Lever `salaryRange` (when present); otherwise salary is `null`.
  - Greenhouse lists one job per city; same-company copies aren't marked as duplicates.

- **Boards become discovery-only.** Board adapters keep running, but their output only feeds company candidates (company name + any ATS link) from postings that pass the tech filter. No board jobs are stored. The HN and Get on Board adapters are removed, leaving 7 discovery boards: Remote OK, We Work Remotely, Remotive, Himalayas, Jobicy, Working Nomads and Arbeitnow. Start a fresh local DB, since the current one holds board jobs.
- **Tables:**
  - `companies`: ATS, slug, name, website, home country (ISO 3166-1 alpha-2, nullable), origin, status (`active` / `inactive`), consecutive failures, last fetched.
  - `company_candidates`, which doubles as the probe cache: normalized name (unique), name, website, careers URL, origin, resolution status (`pending` / `confirmed` / `ambiguous` / `not_found` / `error`), attempts, last checked, next check, resolved company. Retry after 30 days for `not_found` and after 1 day for `error`. `confirmed` and `ambiguous` aren't retried on a timer; a confirmed company is only looked up again if it dies (see "Dead companies").
- **Seeding** with `npm run seed` (run monthly):
  - `remoteintech/remote-jobs`: ISC license, about 880 company files with `website`, `careers_url` and `technologies`.
  - YC companies from `https://yc-oss.github.io/api/companies/all.json`: about 6,400 companies, of which about 4,400 have `status = Active`. Seeded only if `status = Active`, `isHiring = true`, and the home country is allowed or unknown (see "Location filter" rule 3): about 1,370 companies as of 2026-11-16. There's no industry filter, because labels like "Healthcare" or "Fintech" still cover software startups and the tech filter handles relevance. The monthly re-seed picks up companies that start hiring. The dataset has no license, so it's fetched at runtime for personal use and never committed, and test fixtures are a few hand-made records.
- **Manual add and review:** `npm run company -- add <ats> <slug>` (optional name and home country); manual adds are confirmed by definition. `npm run company -- review` lists `ambiguous` companies so I can confirm or reject each one.
- **Precise slug resolution.** Precision first: only `confirmed` candidates become companies, and only `active` companies are fetched.
  1. **Direct link first.** If the candidate's `careers_url`, website URL or a board posting contains an ATS URL (`boards.greenhouse.io/<slug>`, `jobs.lever.co/<slug>`, `jobs.ashbyhq.com/<slug>`, `<slug>.recruitee.com`, `jobs.smartrecruiters.com/<slug>`), use that slug.
  2. **Otherwise, guess at most 3 slugs** from the name (legal suffixes removed) and the website domain, e.g. "Acme Labs, Inc." + `acmelabs.io` → `acmelabs`, `acme-labs`. Probe them against the 5 ATSs.
  3. **Existence:** HTTP 404 means "not there" on Greenhouse, Lever, Ashby and Recruitee. SmartRecruiters answers 200 even for unknown slugs, so it needs at least 1 posting.
  4. **Identity must be proven** by at least one of:
     - the ATS company name normalizes to the candidate's: Greenhouse board `name`, Recruitee `company_name`, SmartRecruiters `company.name`
     - the candidate's website domain appears in the ATS data
     - for Lever and Ashby, which return no company name: the name appears in the descriptions of at least 2 postings (or of the only posting, if there's just 1), or a direct link from step 1
  5. **Outcome:** `confirmed` → added to `companies`. `ambiguous` (exists but identity unproven, or several ATSs match) → not fetched; shown by `npm run company -- review`. `not_found` → retried after 30 days.
- **5 ATS adapters.** Each fetches its active companies with polite per-host pacing (1–2 requests at a time, with a delay), errors isolated per company, and each company fetched at most about once a day.
- **Tech filter** (storage; replaces the M1 tech filter's keyword list). It matches job title, department/team and tags only, never descriptions, where "Next", "Segment" and "AWS" appear almost everywhere. Keywords:
  - full stack / full-stack / fullstack, front end / front-end / frontend, back end / back-end / backend
  - software engineer, software developer, web developer, web engineer, UI engineer, UI developer, product engineer
  - JavaScript, TypeScript, JS, TS, React / React.js / ReactJS, Next.js / NextJS ("Next" alone doesn't count), Node / Node.js / NodeJS
  - martech, marketing technology, Segment, Snowflake, AWS
- **Location filter** (storage, applied after the tech filter). A job is stored only if all three hold:
  1. **Remote only:** `workplaceType` is `remote` or unknown. Hybrid and onsite jobs are dropped.
     - Taken from the ATS when it provides one: Lever `workplaceType`, Ashby `workplaceType`/`isRemote`, Recruitee `remote`/`hybrid`/`on_site`, SmartRecruiters `location.remote`/`hybrid`.
     - Otherwise (e.g. Greenhouse), from the location text: "remote", "anywhere", "worldwide" or "remoto" → `remote`; "hybrid" or "híbrido" → `hybrid`; "onsite", "on-site", "in office" or "presencial" → `onsite`.
     - A location with no remote word, such as just a city ("San Francisco, CA"), counts as `onsite`. Only an empty location is unknown.
  2. **Doable from Argentina:** the job's `regions` include `latam`, `south-america`, `americas`, `argentina` or `worldwide`, or no region is found at all (plain "Remote"; unknown passes). Jobs limited to other countries or areas need residency there and are dropped: "Remote - US only", "Remote, United States", "Remote - Brazil", "Remote - Europe", "Remote - India".
  3. **Company based in the USA, Canada, Europe, Australia or New Zealand,** or with an unknown home country. "Europe" means any European country, including the UK, Switzerland and Norway. Companies based in Argentina, or anywhere else, are dropped.

  Details:
  - **Job `regions` vocabulary:**
    - allowed: `argentina`, `latam`, `south-america`, `americas`, `worldwide`
    - not allowed: `latam-country` (one specific Latin American country other than Argentina), `north-america`, `europe`, `emea`, `apac`
    - Allowed regions come only from Argentina itself or from **multi-country area phrases**. A single country always means residency in that country.
    - Regions come **only from the job's location text**: all of its location strings, e.g. Lever `allLocations` and Ashby `secondaryLocations`. Matching is whole-word, English and Spanish, and case-insensitive:
      - **Country names → that country's regions:**
        - "Argentina", "Buenos Aires" → `argentina`
        - other Latin American countries ("Brazil"/"Brasil", "Mexico"/"México", "Colombia", "Chile", ...) → `latam-country`
        - "United States", "USA", "US", "U.S.", "Canada" → `north-america` (never `americas`)
        - European countries ("United Kingdom", "UK", "Germany"/"Alemania", "Spain"/"España", ...) → `europe`
        - Asian and Oceanian countries ("India", "Singapore", "Australia", "New Zealand", ...) → `apac`
        - Middle Eastern and African countries → `emea`
      - **Area phrases:**
        - "LATAM", "LatAm", "Latin America", "Latinoamérica", "América Latina" → `latam`
        - "South America", "Sudamérica", "América del Sur" → `south-america`
        - "Americas" → `americas`
        - "North America" → `north-america`
        - "Europe", "EU", "European Union", "Europa" → `europe`
        - "EMEA" → `emea`
        - "APAC", "Asia" → `apac`
        - "Anywhere", "Worldwide", "Global" → `worldwide`
      - The country and phrase lists live in one mapping file with a table-driven test.
    - If a job's text says plain "Remote" but its description requires US or EU residency, it passes this filter; Claude scores it low in M4.
  - **Company home country** (`companies.homeCountry`):
    - parsed from the YC dataset's company location (`all_locations`, e.g. "San Francisco, CA, USA" → `US`)
    - settable on manual add
    - otherwise `null`
    - `remoteintech`'s `region` field is where a company hires, not where it's based, so it isn't used. ATSs only give job locations.
  - A "Remote - Argentina" posting from a US or European company is kept: the company is foreign and the job is doable from Argentina. Argentine companies are dropped by rule 3.
  - Board discovery is **not** location-filtered: a company found through a US-only posting may still hire remotely from LATAM.
- **Posting date:** `postedAt` holds the date the posting was first published:
  - Greenhouse `first_published` (not `updated_at`, which changes on edits)
  - Lever `createdAt` (epoch ms)
  - Ashby `publishedAt`
  - Recruitee `published_at` (not `created_at` or `updated_at`)
  - SmartRecruiters `releasedDate`

  If an ATS gives no date, `postedAt` stays `null` and the job's effective date is our `firstSeenAt`. Note that `firstSeenAt` is "today" for every job on a company's first fetch.
- **Workable dropped (2026-11-17).** Its widget API rate limits this machine hard and unpredictably (see the decisions log).
- **Closed jobs:** each fetch returns a company's full list, so a stored job missing from it gets `closedAt`, and it's reopened if it reappears. Closed jobs are never ranked or scored. Jobs closed for more than 30 days are deleted, together with their embeddings and scores.
- **Dead companies:** after 3 consecutive 404s a company becomes `inactive`, and its candidate is resolved again.
- **Dedupe:** only ATS jobs are stored, so cross-source dedupe only applies between ATSs (e.g. a company that switched ATS).

Verify:
- `npm run seed` on a fresh DB creates candidates and confirmed companies.
- 20 random confirmed companies are spot-checked by hand: at least 19 are the right company.
- "Enough" coverage: the first full run gives at least 300 confirmed companies and at least 200 stored open jobs. The resolution rate per source (`remoteintech`, YC, boards) is printed for information only, not as a gate.
- `npm run fetch` stores ATS jobs that pass both storage filters (tech filter + location filter), and only for active companies; no board jobs are stored.
- A table-driven test covers the location filter:
  - **kept:** remote "LATAM", "Americas", "Anywhere" and plain "Remote" postings, a job listing both "Remote - US" and "Remote - LATAM", and "Remote - Brazil, Argentina", at US, Canadian, European, Australian, New Zealand or unknown-origin companies
  - **dropped:** any hybrid or onsite job, "Remote - US only", "Remote, United States", "Remote - Brazil", "Remote - Europe", "Remote - India", a city-only location like "San Francisco, CA" (counts as onsite), and any job at a company based in Argentina, Brazil or India
- A second run the same day skips companies already fetched.
- A job removed from a fixture gets `closedAt`.

### M3: Search config, filters and embedding ranking (current)
- `config/search.md`: one specific search description in plain text, the most visible and easiest-to-change setting. Gitignored; `config/search.example.md` is committed.
- `config/preferences.json` (Zod-validated): hard rules (seniority, salary floor, department). Remote-only and location are already handled by the M2 location filter. Gitignored; `config/preferences.example.json` is committed.
- Filters from the hard rules, using structured ATS fields first and keywords second. **Unknown values pass**; a job is only excluded when its data contradicts a rule.
- Local embeddings with Transformers.js using `onnx-community/gte-multilingual-base` (quantized `q8`, about 340 MB, Apache-2.0, 768 dimensions, CLS pooling + normalize, no prefixes). It reads up to 8,192 tokens, so we embed the title plus the description, capped at about 1,500 tokens to bound CPU time. Verified on 2026-11-16: it loads in Transformers.js (with a warning that it falls back to a generic encoder) and matches English and Spanish postings across languages. Pin the Transformers.js version, and keep a test that loads the model in the live checks. Fallback if it ever breaks: `Xenova/multilingual-e5-small`.
  - each open job is embedded once and re-embedded only if its text changes
  - the search description is embedded whenever `config/search.md` changes
  - jobs are ranked by cosine similarity
- `npm run rank`: prints the top N ranked jobs.

### M4: Claude scoring
- Score the top N (default 100) open, unscored jobs: a 0–100 score plus short reasons. Stored with the model, a hash of the search description (for reference) and the date.
- **Each job is scored once and never re-scored.** Changing `config/search.md` affects ranking for new scoring but leaves existing scores in place.
- `npm run score` scores the top N. `npm run score -- --next` ("get next") continues down the ranking and scores the next page on demand (default 100, configurable), skipping scored and closed jobs.
- **Eligibility:** the scoring prompt states that I work remotely from Argentina, so jobs whose description requires residency or work authorization elsewhere score low.
- API key: `ANTHROPIC_API_KEY` in `.env.local` (gitignored), loaded by npm scripts with Node's `--env-file-if-exists=.env.local` (verify that `tsx` passes it through).
- Cost levers: only filtered + ranked jobs; prompt caching for the shared instructions and search description; several jobs per request; trimmed description text; model choice measured on real jobs.
- A manual live check makes one tiny real scoring call. Unit tests use recorded responses.

### M5: Local UI
List open jobs ranked by score, with reasons and a link to the original ATS posting; save or dismiss jobs (dismissed jobs are hidden; no learning); "get next"; show which search description is active. Tests: React Testing Library for components, Playwright for a few end-to-end checks.

### M6: Automation (later)
Daily `npm run fetch` and monthly `npm run seed` on a local schedule, nightly pre-scoring of new top-ranked jobs with the Batch API (50% cheaper), an email digest of new top matches, and optionally an MCP server so agents can query jobs.

## Open questions
- Claude model for scoring: Opus 5.5 (default) or Haiku 5.5 (much cheaper)? Decide in M4 after measuring quality and cost.

## Notes / Decisions log
- 2026-11-09: Free sources only. No scraping or paid aggregators, because of cost, terms-of-service risk and upkeep.
- 2026-11-09: Personal use and not hosted, so SQLite instead of Postgres.
- 2026-11-09: Fetch broadly, filter locally. A keyword filter runs before Claude to keep AI costs low.
- 2026-11-09: ATS companies are found automatically from job URLs; no manual company list. (Superseded on 2026-11-16.)
- 2026-11-09: The Muse excluded: its API is blocked by Cloudflare (403).
- 2026-11-10: M1 done; Remotive kept (12 jobs, 6h minimum interval). Pinned Node 22 (`.nvmrc`). TypeScript held at 6.0 until typescript-eslint supports 7. About 0.7% of jobs are cross-source duplicates (marked, not deleted).
- 2026-11-12: M1.1 test hardening done: 5 bugs fixed test-first (plus prototype-key entity decoding and Retry-After parsing), exact adapter assertions, offline CLI integration test over all adapters. Coverage 98.7% lines / 89.07% branches (thresholds 95/85/90/95 set). `@vitest/coverage-v8` added.
- 2026-11-16: ATS-only jobs. Companies come from seed lists, board discovery and manual adds. Boards are discovery-only and their jobs are never stored. HN removed as not necessary. Personio and other ATSs stay out.
- 2026-11-16: Only paid service is the Anthropic API; all data sources and embeddings are free.
- 2026-11-16: Slug resolution is precision-first. A company is fetched only when its identity is proven (ATS name, website domain or a direct link); ambiguous matches need manual review. Results are cached in `company_candidates` with retry dates.
- 2026-11-16: Only jobs passing the tech filter (keywords on title/department/tags) are stored, to keep the DB small.
- 2026-11-16: Hard rules keep jobs with unknown values.
- 2026-11-16: One search description for the MVP, in its own file `config/search.md`. Each job is scored once and never re-scored. No learning from save/dismiss decisions.
- 2026-11-16: YC dataset (yc-oss) has no license: fetched at runtime for personal use, never committed. `remoteintech/remote-jobs` is ISC.
- 2026-11-16: Schema re-checked against real ATS data. Approved:
  - `workplaceType` replaces `remote`
  - new fields `departments`, `regions` and `employmentType` (no `countries` field)
  - `companies.homeCountry`
  - `externalId` becomes `<slug>:<id>`
  - 5 ATS source ids
  - companies passed to ATS adapters through `FetchContext`
  - `companyId` and `closedAt` on jobs
- 2026-11-16: Storage location filter: remote only (hybrid and onsite dropped); the posting must be doable from Argentina (Argentina, LATAM, South America, Americas, worldwide, or no region; a single other country such as "Remote - Brazil" or "Remote - US" needs residency there and is dropped); a city-only location without a remote word counts as onsite; the company must be based in the USA, Canada, Europe, Australia or New Zealand, or have an unknown home country. There's no ISO code for LATAM, so job regions use our own vocabulary derived only from location text (country names and area phrases, English and Spanish). Structured ATS countries are ignored because they're often the office country; residency limits stated only in descriptions are left to Claude's scoring. The company home country comes from the YC dataset or manual adds.
- 2026-11-16: No age cutoff anywhere: all open jobs are stored (closed ones get `closedAt`), there is no "max age" hard rule, and the posting date is not sent to Claude. `postedAt` stores each ATS's first-published date, with `firstSeenAt` as the fallback.
- 2026-11-16: Open questions answered:
  - M2 coverage is "enough" at 300 or more confirmed companies and 200 or more stored open jobs.
  - YC seeding keeps only active, hiring companies with an allowed or unknown home country, and uses no industry filter.
  - Only the search description is matched, not my CV (maybe later).
  - Closed jobs are deleted 30 days after closing.
  - The digest is sent by email.
  - The embedding model is `onnx-community/gte-multilingual-base`: free (Apache-2.0), reads whole descriptions, and verified to run in Transformers.js with good English/Spanish matching. Fallback: `Xenova/multilingual-e5-small`.
- 2026-11-16: Get on Board dropped as a discovery source. Its companies are mostly LATAM-based with no known home country, so their "Remote - Argentina" jobs would pass the location filter's "unknown passes" rule.
- 2026-11-17: Workable removed from the app. A real seed run made its widget API answer 429 to every request, even for a known-good slug, and the block lasted over an hour; staged tests showed no spacing that was reliably accepted (8 s worked for 20 requests, then even 5–8 s failed). It was about 7% of confirmed companies and no Workable job was ever fetched. The ATS list is now Greenhouse, Lever, Ashby, Recruitee and SmartRecruiters (12 source ids).
- 2026-11-17: M2 done: 753 active companies (ashby 416, greenhouse 227, lever 67, recruitee 22, smartrecruiters 21), 255 open jobs; resolution rate 25% remoteintech / 32% yc; 78 ambiguous awaiting review. Workable was dropped along the way (see the entry above).
- 2026-11-17: M2.1 review fixes: deactivation closes a company's jobs; ATS failures are classified by HTTP status; SmartRecruiters skips vanished postings and refuses listings over 5,000; Recruitee subdomains share one pacing queue; probe errors are retried instead of becoming ambiguous; new direct links reopen ambiguous candidates; `company reject` is permanent (status `rejected`); EU Greenhouse/Lever links are ignored; closed jobs are never duplicate originals.
- 2026-11-17: M2.2 review fixes: a re-confirmed company is reactivated; a fetch with invalid items closes no jobs; slugs typed into `company add`/`confirm` are normalized (lowercase except SmartRecruiters); the Lever/Ashby name proof ignores legal suffixes.
