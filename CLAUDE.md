# Job Searcher

Personal, single-user tool that collects IT job postings from free public job APIs (job boards, HN "Who is hiring?", ATS job boards), stores them locally, and matches them against saved search descriptions.

## Commands
> Target setup; the scaffold is built in Phase 1 of `PLAN.md`.

- Install: `npm install`
- Dev (web UI): `npm run dev`
- Fetch jobs: `npm run fetch` (single source: `npm run fetch -- --source remoteok`)
- Test: `npm test` (single file: `npm test -- path/to/file.test.ts`)
- Live API checks (real network, run manually): `npm run test:live`
- Lint/typecheck: `npm run lint && npm run typecheck`
- DB: `npm run db:generate` (new migration), `npm run db:migrate` (apply)

## Architecture
Next.js (App Router) + TypeScript strict, SQLite + Drizzle, Zod, Vitest, `tsx` for scripts.

- `src/sources/` – one adapter per source: `boards/` (job boards, HN) and `ats/` (Greenhouse, Lever, ...). The interface lives in `types.ts`, enabled adapters in `registry.ts`.
- `src/core/` – normalized `Job` schema, dedupe, keyword filter, shared HTTP helper
- `src/db/` – Drizzle schema, client, queries
- `src/ai/` – Claude calls (later phase)
- `src/scripts/` – CLI entry points
- `src/app/` – UI
- `test/fixtures/<source>/` – recorded real API responses

Key patterns:
- Every source implements `SourceAdapter` and outputs the shared `Job` shape. A new source is one file plus a registry entry.
- Validate every external response with Zod before normalizing.
- All DB access goes through `src/db/`; all HTTP goes through `src/core/http.ts`.

## Conventions
- kebab-case file names. An adapter's `id` equals its file name.
- Named exports and pure functions. Network and DB calls stay at the edges.
- One failing source never breaks a run: adapters return `{ source, jobs, error }`, and the runner logs the error and continues.
- Timestamps are UTC ISO strings.
- Every job keeps `source` and the original `url`. The UI shows "via <Source>" with a link, because some sources require it.
- TDD for core logic. Adapters are tested against fixtures. Unit tests never hit the network; live checks go in `*.live.test.ts`.
- Testing stack: Vitest for unit, adapter, and DB tests (DB tests use in-memory SQLite). React Testing Library + Playwright are added for the UI in M4. No Jest or Enzyme.

## Workflow
- Plan: see `PLAN.md`. Tick off checkboxes when a milestone's tasks are done.
- Run tests, lint, and typecheck before declaring a task finished.
- Commit in small steps on `feat/<topic>` / `fix/<topic>` branches. Never commit to `main` directly.

## Rules (don'ts)
- Ask before adding dependencies.
- Never edit generated files (`drizzle/`, `.next/`), and never read or commit `.env*`.
- Don't change the `Job` schema or the `SourceAdapter` interface without asking.
- Free public APIs and feeds only. No scraping, no paid APIs, no LinkedIn/Wellfound.
- Respect each source's rate limits. Use the generic User-Agent `job-searcher-mvp/0.1` and never send personal data.
- Single user: no auth or multi-tenant code.
