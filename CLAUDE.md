# Job Searcher

Personal, single-user tool that fetches IT jobs from companies' ATS job boards (Greenhouse, Lever, Ashby, Recruitee, SmartRecruiters), filters and ranks them against one search description with local embeddings, and has Claude score only the top matches, once per job. Companies come from seed lists, job-board discovery and manual adds. See the Pipeline section of `PLAN.md`.

## Commands
- Install: `npm install`
- Dev (web UI): `npm run dev`
- Fetch jobs: `npm run fetch` (single source: `npm run fetch -- --source remoteok`; `--force` ignores intervals; `--skip-resolve` skips resolving new candidates). It discovers companies from boards, resolves candidates to ATS boards, and refreshes ATS jobs.
- Seed companies: `npm run seed [-- --limit N | --no-resolve | --only yc|remoteintech]` (monthly; resumable)
- Companies: `npm run company -- add|review|confirm|reject|sample`
- Rank jobs: `npm run rank [-- --top N]` (embeds new or changed open jobs locally, then prints the best matches)
- Test: `npm test` (single file: `npm test -- path/to/file.test.ts`)
- Live API checks (real network, run manually): `npm run test:live`
- Coverage: `npm run test:coverage` (text summary; HTML report in `coverage/`; thresholds enforced)
- Lint/typecheck: `npm run lint && npm run typecheck`
- DB: `npm run db:generate` (new migration), `npm run db:migrate` (apply)
- Planned:
  - `npm run score` and `npm run score -- --next` (M4)

## Configuration and secrets
- `config/search.md`: the one search description (M3). `config/job-filter-rules.json`: every job filter (keywords, seniority, salary floor, excluded departments and title words), applied once at fetch; without it, fetch uses `config/job-filter-rules.example.json`. Both are gitignored; their `*.example.*` files are committed and kept in sync.
- `ANTHROPIC_API_KEY` lives in `.env.local` (gitignored), loaded by npm scripts with Node's `--env-file-if-exists=.env.local` (M4).

## Architecture
Node 22 (`.nvmrc`; run `nvm use`). Next.js (App Router) + TypeScript strict, SQLite + Drizzle, Zod, Vitest, `tsx` for scripts, Transformers.js for local embeddings (M3), Anthropic SDK (M4).

- `src/sources/` – one adapter per source. The interface lives in `types.ts`, enabled adapters in `registry.ts`.
  - `ats/` (M2) – Greenhouse, Lever, ...: the only source of stored jobs
  - `boards/` – job boards from M1; from M2 they only discover companies, and their jobs are never stored
- `src/companies/` (M2) – seeding, candidate discovery and precise ATS slug resolution
- `src/ranking/` (M3) – search description loading, local embeddings and similarity ranking
- `src/ai/` (M4) – Claude scoring
- `src/core/` – normalized `Job` schema, dedupe, storage filters applied at fetch (job filter rules + location filter), text helpers, shared HTTP helper
- `src/db/` – Drizzle schema, client, queries
- `src/scripts/` – CLI entry points
- `src/app/` – UI (M5)
- `config/` – search description and job filter rules (M3)
- `test/fixtures/<source>/` – recorded real API responses

Key patterns:
- Every source implements `SourceAdapter` and outputs the shared `Job` shape. A new source is one file plus a registry entry.
- Validate every external response with Zod before normalizing.
- All DB access goes through `src/db/`; all HTTP goes through `src/core/http.ts`.
- Cheap before expensive: storage filters at fetch (job filter rules + location filter), then embeddings, then Claude on the top N. Each job is embedded once (again only if its text changes) and scored once, ever.

## Conventions
- kebab-case file names. An adapter's `id` equals its file name.
- Named exports and pure functions. Network and DB calls stay at the edges.
- One failing source never breaks a run: `runAdapter` and the runner turn any failure (network, validation or DB) into an `error` result for that source, record it, and continue.
- Timestamps are UTC ISO strings.
- Every job keeps `source` and the original posting `url`; the UI links to it.
- TDD for core logic. Adapters are tested against fixtures.
- Testing stack: Vitest for unit, adapter, and DB tests (DB tests use in-memory SQLite). React Testing Library + Playwright are added for the UI in M5. No Jest or Enzyme.
- Unit tests never hit the network, call Claude or download embedding models; use recorded responses or small fixed vectors. Manual live checks (`*.live.test.ts`, `npm run test:live`) may make small real calls to confirm an external service still matches the fixtures.

## Workflow
- Plan: see `PLAN.md`. Tick off checkboxes when a milestone's tasks are done.
- Run tests, lint, and typecheck before declaring a task finished.
- Claude workers (`.github/workflows/claude-*.yml`, sharing `claude-worker.yml`) open small PRs labeled `bot`: maintenance nightly, docs sync on Tuesdays, test quality on Thursdays, simplify on Saturdays. They skip a run while 3 or more `bot` PRs are open. Writing `@claude` in an issue or PR comment (owner only) runs `claude-mention.yml`.
- Commits follow Conventional Commits: `<type>(<scope>): <summary>`, where type is one of `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- Branches are `<type>/<topic>` using the same types. Commit in small steps; never commit to `main` directly.
- PRs target `main`. `.github/workflows/claude-review.yml` reviews every PR against this file, and `ci.yml` runs lint, typecheck, tests with coverage, a Drizzle migration drift check and a forbidden-files check. Still run the checks locally before pushing. `live-checks.yml` runs `npm run test:live` nightly and opens an issue on failure; Dependabot opens weekly update PRs. Merge with a merge commit and delete the branch. Stacked PRs: retarget the next PR to `main` before merging it.

## Rules (don'ts)
- Ask before adding dependencies.
- Never edit generated files (`drizzle/`, `.next/`, `coverage/`).
- Never read or commit `.env*`.
- Never commit `config/search.md` or `config/job-filter-rules.json` (personal). Reading or editing them is fine when asked.
- Don't change the `Job` schema or the `SourceAdapter` interface without asking (the M2 changes listed in `PLAN.md` are approved).
- Data sources must be free and public. No scraping, and never fetch company websites or careers pages; only parse URLs we already have. No LinkedIn/Wellfound.
- The Anthropic API (Claude) is the only paid service. Embeddings run locally.
- Respect rate limits. ATS polling is paced per host, and each company is fetched at most about once a day. Use the generic User-Agent `job-searcher-mvp/0.1` and never send personal data to job sources or seed lists. The search description and my location go only to the Anthropic API, for scoring.
- Only open jobs that passed the filters and embedding ranking go to Claude, and a job that already has a score is never sent again.
- Single user: no auth or multi-tenant code.
