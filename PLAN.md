# Job Searcher MVP Plan

## Goal
A personal tool that collects IT jobs from free public job APIs and shows me the ones that match my saved search descriptions. Done = one command fetches from every free source into a local database, and a local UI lists jobs matching each search, ranked by Claude.

## Scope
- In:
  - free job board APIs and feeds
  - HN "Who is hiring?"
  - ATS job boards, with companies discovered automatically
  - one or more saved searches
  - keyword filter, then Claude scoring
  - local UI
- Out (for now):
  - hosting or a public demo
  - auth and multiple users
  - LinkedIn and Wellfound (I handle those manually)
  - scraping
  - paid APIs
  - free APIs that need a key (Adzuna, Jooble, Findwork)

## Stack & key decisions
- TypeScript + Next.js (App Router): a stack I already know; UI and code in one project.
- SQLite + Drizzle: a local file with typed queries. A single user doesn't need a database server.
- Zod: external APIs change shape, so every response is validated.
- Vitest: tests run against recorded API responses, so they work offline and give the same result every time.
- Anthropic SDK (Claude): turns a search description into filters and scores the shortlisted jobs.
- Hosting: none. It runs locally.

## Milestones
### M1: Direct job board APIs (current)
- [ ] Scaffold: Next.js + TS strict, ESLint, Vitest, tsx, and the npm scripts listed in CLAUDE.md. The DB file goes in `data/` (gitignored).
- [ ] `Job` Zod schema + `SourceAdapter` interface
- [ ] Shared HTTP helper (timeout, retry, User-Agent)
- [ ] DB: `jobs` and `fetch_runs` tables; upsert on (source, externalId)
- [ ] Fetch runner + `npm run fetch` CLI: errors isolated per source, summary per source
- [ ] Remote OK adapter + fixture tests (first end-to-end slice)
- [ ] We Work Remotely adapter (RSS)
- [ ] Get on Board adapter
- [ ] Remotive adapter
- [ ] Himalayas adapter (incremental: stop at the first known job)
- [ ] Jobicy adapter
- [ ] Working Nomads adapter
- [ ] Arbeitnow adapter (keep IT roles only)
- [ ] HN "Who is hiring?" adapter (latest thread; free-text posts)
- [ ] Dedupe across sources (URL + company/title/location)
- [ ] One live check per adapter (`npm run test:live`)

Verify: `npm test`, lint, and typecheck pass. `npm run test:live` gets jobs from every source. Running `npm run fetch` twice adds only new jobs on the second run.

### M2: ATS sources
Find ATS companies automatically from job URLs and HN posts. Add adapters for Greenhouse, Lever, Ashby, Workable, Recruitee and SmartRecruiters. Poll each known company. Backfill companies from past HN threads once.

### M3: Saved searches + matching
Store several search descriptions. Claude turns each one into filters. A keyword filter builds the shortlist, and Claude scores it (score + reasons).

### M4: Local UI
List matches for each search, with filters and "via <Source>" links. Mark jobs as seen, saved or dismissed. Tests: React Testing Library for components, Playwright for a few end-to-end checks.

### M5: Automation (later)
Fetch on a local schedule, send a daily digest of new matches, and optionally add an MCP server so agents can query jobs.

## Open questions
- Match against my CV too, or only the search descriptions? (M3)
- Claude model for scoring: Opus 5.5 (default) or Haiku 5.5 (much cheaper)? Decide in M3 after measuring cost.
- How long to keep jobs, and how to detect expired postings?
- The Remotive free feed returns only about 12 jobs. Keep it or drop it?
- Arbeitnow: identify IT roles by tags or by keywords?
- Digest channel: email or Telegram? (M5)

## Notes / Decisions log
- 2026-11-09: Free sources only. No scraping or paid aggregators, because of cost, terms-of-service risk and upkeep.
- 2026-11-09: Personal use and not hosted, so SQLite instead of Postgres.
- 2026-11-09: Fetch broadly, filter locally. A keyword filter runs before Claude to keep AI costs low.
- 2026-11-09: ATS companies are found automatically from job URLs; no manual company list.
- 2026-11-09: The Muse excluded: its API is blocked by Cloudflare (403).
