# M1: Direct job board APIs

## Goal
`npm run fetch` pulls recent IT jobs from 9 free sources (Remote OK, We Work Remotely, Get on Board, Remotive, Himalayas, Jobicy, Working Nomads, Arbeitnow, HN "Who is hiring?") into a local SQLite DB. Each source is tested offline against recorded fixtures and online through live checks.

## Context
- Read `CLAUDE.md` first. Its rules apply to every task, especially these:
  - Ask before adding dependencies (T1's list is the approved set).
  - All DB access goes through `src/db/`; all HTTP goes through `src/core/http.ts`.
  - Validate every external response with Zod before normalizing.
  - One failing source never breaks a run.
  - Unit tests never hit the network.
  - User-Agent is exactly `job-searcher-mvp/0.1`.
  - Never read or commit `.env*`.
- Branch: `feat/m1-board-apis`, which already exists. Make one commit per task, with the message `feat(m1): T<n> <summary>`. Never commit to `main`.
- The repo contains only `CLAUDE.md`, `PLAN.md` and this spec. Node is v22 (see `.nvmrc`).
- Decisions already made:
  - SQLite through `better-sqlite3` + Drizzle.
  - DB file at `./data/jobs.db`, overridable with `DATABASE_URL` (`file:` prefix optional).
  - Test runner is Vitest. No Jest.
  - The app runs locally only.
- Tick each task's `[ ] Done` box when its Verify step passes. When every task mapped to a root `PLAN.md` M1 item is done, tick that item too (mapping at the end of this spec).

## Out of scope
- Do not build any UI beyond the placeholder page that comes with the scaffold.
- Do not add saved searches, keyword search filters, Claude/AI calls, ATS adapters (M2), scheduling or notifications.
- Do not add dependencies beyond the T1 list. If you think you need one, stop and ask.
- Do not change the `Job` schema or the `SourceAdapter` interface after T3 without asking.
- Do not hand-edit files in `drizzle/` (they are generated).

## Tasks

### T1: Scaffold the project
- Files:
  - `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `next-env.d.ts`
  - `src/app/layout.tsx`, `src/app/page.tsx`
  - `.gitignore`, `vitest.config.ts`, `vitest.live.config.ts`, `drizzle.config.ts`
- Steps:
  1. Generate a scaffold in a temporary folder outside the repo:
     ```
     npx create-next-app@latest <tmp>/scaffold --ts --eslint --app --src-dir --no-tailwind --import-alias "@/*" --use-npm --skip-install --yes
     ```
     If it prompts anyway, answer No to Tailwind, React Compiler and Turbopack questions.
  2. Copy from the scaffold only: `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `next-env.d.ts`, `.gitignore`, `src/app/layout.tsx`, `src/app/page.tsx`. **Do not copy `README.md`, `CLAUDE.md`, `AGENTS.md`, `public/` or CSS files.**
  3. Strip the CSS imports from `layout.tsx` and replace `page.tsx` with an `<h1>Job Searcher</h1>` placeholder.
  4. Install the dependencies (these are the only approved packages):
     - runtime: `drizzle-orm better-sqlite3 zod rss-parser`
     - dev: `drizzle-kit vitest tsx @types/better-sqlite3`
     - `@types/node`, `@types/react` and `eslint-config-next` come from the scaffold.
  5. In `package.json`, set `"name": "job-searcher"` and `"engines": { "node": ">=20.9" }`, and these scripts:
     - `dev`: `next dev`
     - `build`: `next build`
     - `start`: `next start`
     - `lint`: `eslint .`
     - `typecheck`: `tsc --noEmit`
     - `test`: `vitest run`
     - `test:watch`: `vitest`
     - `test:live`: `vitest run --config vitest.live.config.ts`
     - `fetch`: `tsx src/scripts/fetch.ts`
     - `db:generate`: `drizzle-kit generate`
     - `db:migrate`: `drizzle-kit migrate`
  6. In `tsconfig.json`, keep `"strict": true` and add `"noUncheckedIndexedAccess": true`.
  7. `vitest.config.ts`:
     - `test.include: ["src/**/*.test.ts"]`
     - `test.exclude: ["**/*.live.test.ts", "node_modules/**"]`
     - `resolve.alias: { "@": <absolute path to ./src> }`
     - `test.environment: "node"`
  8. `vitest.live.config.ts`: same alias, `include: ["src/**/*.live.test.ts"]`, `testTimeout: 60000`.
  9. `drizzle.config.ts`:
     - `dialect: "sqlite"`
     - `schema: "./src/db/schema.ts"`
     - `out: "./drizzle"`
     - `dbCredentials.url`: `DATABASE_URL` with any `file:` prefix stripped, defaulting to `./data/jobs.db`
  10. `.gitignore`: keep the scaffold's entries and add `data/` and `coverage/`. Make sure `.env*` is ignored.
- Tests first: none (setup task).
- Verify:
  - `npm run lint && npm run typecheck` exits 0.
  - `npm test` reports "No test files found". Accept exit code 1 here only; from T2 on it must be 0.
  - `npm run dev` serves "Job Searcher" at http://localhost:3000.
- [x] Done

### T2: Text and date helpers (depends on T1)
- Files: `src/core/text.ts`, `src/core/text.test.ts`, `src/core/dates.ts`, `src/core/dates.test.ts`
- Interfaces:
  ```ts
  export function decodeEntities(s: string): string
  export function htmlToText(html: string): string
  export function normalizeTags(tags: Array<string | null | undefined>): string[]
  export function toIsoUtc(input: string | number | null | undefined): string | null
  ```
- Behavior:
  - `decodeEntities`:
    - Decodes `&amp; &lt; &gt; &quot; &#39; &apos; &nbsp;`, decimal `&#123;` and hex `&#x2F;`.
    - Unknown entities stay as they are.
    - Single pass: `&amp;lt;` becomes `&lt;`.
  - `htmlToText`:
    1. Decode entities.
    2. Replace `<br>`, `</p>`, `</li>`, `</h1>`–`</h6>` and `</div>` with `\n`.
    3. Replace `<li>` with `- `.
    4. Remove all other tags.
    5. Decode entities again (handles double-encoded input).
    6. Collapse runs of spaces/tabs to one space, trim every line, and collapse 3+ newlines to 2.
    7. Trim the result.
  - `normalizeTags`: lowercases and trims each tag, replaces `-` and `_` with a space, drops empty/null values, removes duplicates and keeps first-seen order.
  - `toIsoUtc`:
    - A number is epoch **seconds**.
    - A string with a timezone or offset is parsed as is.
    - A string without one (e.g. `2026-11-07T01:10:55`) is treated as UTC.
    - An RFC 2822 string (`Sun, 18 Oct 2026 07:31:05 +0000`) is parsed with `new Date()`.
    - Returns `Date.toISOString()`, or `null` for null, undefined, empty or unparseable input.
- Tests first (`it` names):
  - `decodes named and numeric entities`
  - `decodes only one level` (`&amp;lt;` → `&lt;`)
  - `htmlToText converts lists and paragraphs to lines`: `<p>a</p><ul><li>b</li></ul>` → `a\n- b`
  - `htmlToText handles double-encoded html`: `&lt;p&gt;hi&lt;/p&gt;` → `hi`
  - `normalizeTags dedupes and lowercases`: `["React","react "," Node-JS",null,""]` → `["react","node js"]`
  - `toIsoUtc handles epoch seconds`: `1794153615` → `2026-11-08T16:00:15.000Z`
  - `toIsoUtc treats naive strings as UTC`
  - `toIsoUtc parses offsets`: `2026-11-09T08:52:38-05:00` → `2026-11-09T13:52:38.000Z`
  - `toIsoUtc parses RFC 2822`
  - `toIsoUtc returns null for garbage`
- Verify: `npm test -- src/core` passes, and `npm run typecheck` exits 0.
- [x] Done

### T3: `Job` schema and `SourceAdapter` interface (depends on T2)
- Files: `src/core/job.ts`, `src/core/job.test.ts`, `src/sources/types.ts`
- Interfaces (`src/core/job.ts`):
  ```ts
  export const SOURCE_IDS = ["remoteok","weworkremotely","getonboard","remotive","himalayas","jobicy","workingnomads","arbeitnow","hn-hiring"] as const;
  export type SourceId = (typeof SOURCE_IDS)[number];
  export const JobSchema = z.object({
    source: z.enum(SOURCE_IDS),
    externalId: z.string().min(1),
    url: z.string().url(),                 // original posting URL on the source (attribution link)
    applyUrl: z.string().url().nullable(),
    title: z.string().min(1),
    company: z.string().min(1),
    location: z.string().nullable(),        // free text as given by the source
    remote: z.boolean().nullable(),         // null = unknown
    tags: z.array(z.string()),              // always passed through normalizeTags
    salaryMin: z.number().positive().nullable(),
    salaryMax: z.number().positive().nullable(),
    salaryCurrency: z.string().length(3).nullable(), // ISO 4217, uppercase
    salaryPeriod: z.enum(["year","month","hour"]).nullable(),
    descriptionHtml: z.string(),
    descriptionText: z.string(),
    postedAt: z.string().datetime().nullable(),
  });
  export type Job = z.infer<typeof JobSchema>;
  export function salaryPeriodFrom(raw: string | null | undefined): Job["salaryPeriod"]
  ```
  `salaryPeriodFrom` maps `annual|yearly|year` → `year`, `monthly|month` → `month`, `hourly|hour` → `hour`, and anything else → `null`. It is case-insensitive.
- Interfaces (`src/sources/types.ts`):
  ```ts
  export interface FetchContext {
    http: HttpClient;                 // from src/core/http.ts (T4); import the type only
    latestPostedAt: string | null;    // max postedAt already stored for this source, or null
    log: (msg: string) => void;
  }
  export interface SourceAdapter<Raw> {
    id: SourceId;
    name: string;               // display name, e.g. "Remote OK"
    homepage: string;           // e.g. "https://remoteok.com"
    minIntervalMinutes: number; // runner skips the source if the last successful run is more recent
    techFilter: boolean;        // true for sources that mix IT and non-IT jobs
    itemSchema: z.ZodType<Raw>; // validates ONE raw item
    fetch(ctx: FetchContext): Promise<unknown[]>; // raw items; validates the response envelope itself
    normalize(raw: Raw): Job | null;              // null = item unusable, skip it
  }
  export type AnyAdapter = SourceAdapter<unknown>;
  export function defineAdapter<Raw>(a: SourceAdapter<Raw>): AnyAdapter // returns `a` (the type cast lives here only)
  export interface FetchResult {
    source: SourceId;
    status: "success" | "error" | "skipped";
    fetched: number;  // raw items returned by fetch()
    invalid: number;  // items rejected by itemSchema, by normalize returning null, or by JobSchema
    filtered: number; // items dropped by the tech filter
    jobs: Job[];
    error: string | null;
    durationMs: number;
  }
  ```
  Because T3 runs before T4, create `src/core/http.ts` now with just the exported `HttpClient` interface from T4. T4 fills in the rest.
- Tests first: `src/core/job.test.ts`
  - `accepts a valid job`
  - `rejects empty title`
  - `rejects non-url url`
  - `rejects lowercase or 2-letter currency`
  - `salaryPeriodFrom maps known values and returns null otherwise`
- Verify: `npm test -- src/core/job.test.ts` passes, and `npm run typecheck` exits 0.
- [x] Done

### T4: HTTP client (depends on T3)
- Files: `src/core/http.ts`, `src/core/http.test.ts`
- Interfaces:
  ```ts
  export interface HttpClient {
    getJson(url: string): Promise<unknown>;
    getText(url: string): Promise<string>;
  }
  export class HttpError extends Error { constructor(public status: number, public url: string, message: string) }
  export interface HttpOptions {
    fetchFn?: typeof fetch;               // default globalThis.fetch
    sleep?: (ms: number) => Promise<void>; // default setTimeout-based
    timeoutMs?: number;                    // default 20000
    retries?: number;                      // default 2 (so max 3 attempts)
  }
  export const USER_AGENT = "job-searcher-mvp/0.1";
  export function createHttpClient(opts?: HttpOptions): HttpClient
  ```
- Behavior:
  - Every request sends `User-Agent: job-searcher-mvp/0.1`. `getJson` also sends `Accept: application/json`. Nothing else, and never personal data.
  - Each attempt has a timeout via `AbortSignal.timeout(timeoutMs)`.
  - **Retries** happen on network errors, timeouts, HTTP 429 and HTTP 5xx.
    - Wait `1000 * attempt` ms before each retry.
    - On 429 with a numeric `Retry-After` header, wait that many seconds instead, capped at 30.
  - **Other non-2xx statuses** throw `HttpError` immediately, without retrying.
  - When retries are exhausted, throw the last error. For HTTP statuses that's an `HttpError` with message `HTTP <status> for <url>`.
  - `getJson` throws `Error("Invalid JSON from <url>")` when parsing fails. This is not retried.
- Tests first: use a fake `fetchFn` and an instant `sleep` spy. No network.
  - `sends the user agent`
  - `returns parsed json`
  - `retries on 503 then succeeds` (3 calls total when it fails twice)
  - `does not retry on 404 and throws HttpError`
  - `honors Retry-After on 429` (sleep called with 5000 for header "5")
  - `gives up after retries` (3 calls, throws)
  - `throws on invalid json`
- Verify: `npm test -- src/core/http.test.ts` passes.
- [x] Done

### T5: Tech filter and dedupe key (depends on T3)
- Files: `src/core/tech-filter.ts`, `src/core/tech-filter.test.ts`, `src/core/dedupe.ts`, `src/core/dedupe.test.ts`
- Interfaces:
  ```ts
  export const TECH_KEYWORDS: readonly string[]
  export function isTechJob(job: Pick<Job, "title" | "tags">): boolean
  export function normalizeCompany(name: string): string
  export function normalizeTitle(title: string): string
  export function dedupeKey(job: Pick<Job, "company" | "title">): string // `${normalizeCompany}|${normalizeTitle}`
  ```
- Behavior:
  - `TECH_KEYWORDS`, exactly these: `developer, engineer, engineering, software, programmer, programming, devops, sre, sysadmin, system administrator, frontend, front end, backend, back end, full stack, fullstack, web, mobile, ios, android, data scientist, data engineer, data analyst, machine learning, ml, ai, qa, test automation, security, cloud, architect, infrastructure, platform, database, dba, it support, technical support, tech lead, cto`
  - `isTechJob`:
    - Searches the lowercased title plus `tags.join(" ")`, with `-` replaced by a space.
    - Returns true if any keyword matches as a whole word or phrase, using regex `\b<keyword>\b`.
    - Single-letter or 2-letter keywords (`ml`, `ai`, `qa`) must also match as whole words, so "email" does not match `ai`.
  - `normalizeCompany`:
    1. Lowercase.
    2. Remove a trailing legal suffix (`inc, inc., llc, ltd, ltd., gmbh, s.a., sa, corp, corporation, co, co.`), after an optional comma.
    3. Remove all non-alphanumeric characters.
  - `normalizeTitle`: lowercase, replace non-alphanumerics with a space, collapse spaces, trim. Seniority words stay ("senior" ≠ "junior").
- Tests first:
  - `matches developer titles`
  - `matches via tags only` (title "Rockstar", tags ["software development"])
  - `rejects sales roles` ("Account Executive", tags ["sales"])
  - `does not match ai inside email` ("Email Marketing Manager" → false)
  - `normalizeCompany strips suffix and punctuation`: "Acme, Inc." → "acme"
  - `dedupeKey is stable across formatting`: ("ACME Inc", "Senior React Dev!") equals ("acme", "senior react dev")
- Verify: `npm test -- src/core` passes.
- [x] Done

### T6: DB schema, migrations, client (depends on T3)
- Files: `src/db/schema.ts`, `src/db/client.ts`, `src/db/client.test.ts`, `drizzle/` (generated)
- Schema (`src/db/schema.ts`, Drizzle `sqlite-core`):
  - `jobs`:
    - `id` integer pk autoincrement
    - `source` text notNull
    - `externalId` (`external_id`) text notNull
    - `url` text notNull
    - `applyUrl` (`apply_url`) text
    - `title` text notNull
    - `company` text notNull
    - `location` text
    - `remote` integer `{ mode: "boolean" }` (nullable)
    - `tags` text `{ mode: "json" }`, typed `string[]`, notNull, default `[]`
    - `salaryMin` / `salaryMax` (`salary_min` / `salary_max`) real
    - `salaryCurrency` (`salary_currency`) text
    - `salaryPeriod` (`salary_period`) text
    - `descriptionHtml` (`description_html`) text notNull
    - `descriptionText` (`description_text`) text notNull
    - `postedAt` (`posted_at`) text
    - `firstSeenAt` (`first_seen_at`) text notNull
    - `lastSeenAt` (`last_seen_at`) text notNull
    - `dedupeKey` (`dedupe_key`) text notNull
    - `duplicateOf` (`duplicate_of`) integer, nullable, references `jobs.id`
    - Indexes: unique `jobs_source_external_id_uq` on (source, external_id); `jobs_dedupe_key_idx`; `jobs_posted_at_idx`.
  - `fetch_runs`:
    - `id` integer pk autoincrement
    - `source` text notNull
    - `startedAt` (`started_at`) text notNull
    - `finishedAt` (`finished_at`) text notNull
    - `status` text notNull (`success | error | skipped`)
    - `fetched`, `inserted`, `updated`, `invalid`, `filtered`: each integer notNull default 0
    - `error` text
    - Index on (source, started_at).
- Client (`src/db/client.ts`):
  ```ts
  export type Db = BetterSQLite3Database<typeof schema>;
  export function openDb(opts?: { url?: string; migrate?: boolean }): Db
  ```
  - Resolve the path in this order: `opts.url`, then `process.env.DATABASE_URL`, then `"./data/jobs.db"`, stripping any `file:` prefix.
  - `":memory:"` is allowed.
  - For a file path, create the parent directory (`mkdirSync(..., { recursive: true })`).
  - Enable `PRAGMA journal_mode = WAL` (file DBs only) and `PRAGMA foreign_keys = ON`.
  - If `migrate` is true, run `migrate(db, { migrationsFolder: <absolute path to repo>/drizzle })`.
- Steps: write the schema, run `npm run db:generate` to create the migration, and commit the generated files without editing them.
- Tests first:
  - `openDb(':memory:', migrate) creates both tables`: insert and select one row in each
  - `unique constraint on source+external_id`: a second insert throws
- Verify: `npm test -- src/db` passes, and `npm run db:migrate` creates `data/jobs.db`.
- [x] Done

### T7: DB queries (depends on T5, T6)
- Files: `src/db/queries.ts`, `src/db/queries.test.ts`
- Interfaces (all synchronous, because better-sqlite3 is synchronous):
  ```ts
  export function upsertJobs(db: Db, jobs: Job[], nowIso: string): { inserted: number; updated: number }
  export function latestPostedAt(db: Db, source: SourceId): string | null
  export function lastSuccessfulRunAt(db: Db, source: SourceId): string | null  // finished_at of latest status='success'
  export function recordRun(db: Db, run: Omit<typeof fetchRuns.$inferInsert, "id">): void
  export function countJobs(db: Db, source?: SourceId): number
  ```
- Behavior of `upsertJobs`:
  - It runs inside one transaction.
  - For each job, look up the row by (source, externalId).
  - **New job:** insert with `firstSeenAt = lastSeenAt = nowIso` and `dedupeKey = dedupeKey(job)`. Count it as inserted.
  - **Existing job:** update every Job field plus `lastSeenAt` and `dedupeKey`. Don't touch `firstSeenAt`. Count it as updated.
  - Cross-source duplicate marking is added in T19. Until then, `duplicateOf` stays null.
- Tests first: use `openDb({ url: ":memory:", migrate: true })`.
  - `inserts new jobs and counts them`
  - `second upsert of same jobs counts as updated and keeps firstSeenAt`
  - `updates changed title`
  - `latestPostedAt returns max postedAt per source and null when empty`
  - `lastSuccessfulRunAt ignores error runs`
- Verify: `npm test -- src/db` passes.
- [x] Done

### T8: Adapter pipeline (depends on T3, T5)
- Files: `src/sources/run-adapter.ts`, `src/sources/run-adapter.test.ts`
- Interface:
  ```ts
  export async function runAdapter(adapter: AnyAdapter, ctx: FetchContext): Promise<FetchResult>
  ```
  It does not touch the DB.
- Behavior:
  1. Record the start time, then call `adapter.fetch(ctx)`. If it throws, return `status: "error"`, `error: "<err.name>: <err.message>"`, all counts 0 and `jobs: []`. Never rethrow.
  2. For each raw item:
     - Run `itemSchema.safeParse`. On failure, `invalid++` and log the first 3 failures via `ctx.log` with the Zod issue path and message.
     - Run `normalize`. If it returns null, `invalid++`.
     - Run `JobSchema.safeParse` on the result. On failure, `invalid++` and log the issue.
     - If `adapter.techFilter && !isTechJob(job)`, `filtered++`.
     - Otherwise, keep the job.
  3. If the same `externalId` appears more than once in a run, keep the first one.
  4. Return `status: "success"`, `fetched = items.length`, the counts, `jobs`, `error: null` and `durationMs`.
- Tests first: use a fake adapter defined in the test.
  - `returns error result when fetch throws`
  - `counts invalid items from schema failures`
  - `counts normalize null as invalid`
  - `applies tech filter only when enabled`
  - `dedupes repeated externalIds`
- Verify: `npm test -- src/sources/run-adapter.test.ts` passes.
- [x] Done

### T9: Remote OK adapter + registry (depends on T4, T8)
- Files:
  - `src/sources/boards/remoteok.ts`, `src/sources/boards/remoteok.test.ts`
  - `src/sources/registry.ts`
  - `test/fixtures/remoteok/api.json`
  - `src/test-utils/fixtures.ts`, exporting `loadFixture(path: string): unknown` and `loadFixtureText(path: string): string`, which read from `test/fixtures/`
- Fixture: run `curl -A "job-searcher-mvp/0.1" https://remoteok.com/api` and keep:
  - element 0 (the legal notice)
  - 3 tech jobs, at least one with `salary_max > 0`
  - 1 non-tech job
  - Pretty-print the result.
- Adapter details:
  - id `remoteok`, name `Remote OK`, homepage `https://remoteok.com`, `minIntervalMinutes: 60`, `techFilter: true`
  - `fetch`: GET `https://remoteok.com/api`. The envelope must be an array (Zod `z.array(z.unknown())`). Drop every element without an `id` property (element 0 is the legal notice). Return the rest.
  - `itemSchema` fields:
    - `id`: string or number, coerced to string
    - `position`: string
    - `company`: string
    - `url`: string
    - `apply_url`: string, optional
    - `description`: string, default ""
    - `tags`: string[], default []
    - `location`: string, default ""
    - `salary_min` / `salary_max`: number, default 0
    - `date`: string
  - `normalize`:
    - `externalId = id`, `url = url`, `applyUrl = apply_url || null`
    - `title = decodeEntities(position)`, `company = decodeEntities(company)`
    - `location = location || null`, `remote = true`
    - `tags = normalizeTags(tags)`
    - Salary fields are null when 0; otherwise currency `USD` and period `year`.
    - `descriptionHtml = description`, `descriptionText = htmlToText(description)`
    - `postedAt = toIsoUtc(date)`
- Registry: `export const adapters: AnyAdapter[] = [remoteok]`, plus `export function getAdapter(id: string): AnyAdapter | undefined`.
- Tests first, using the fixture and a fake `HttpClient` that returns it:
  - `fetch drops the legal notice`
  - `normalizes a job with salary`
  - `sets salary null when zero`
  - `runAdapter filters the non-tech job` (filtered === 1)
- Verify: `npm test -- src/sources` passes.
- [x] Done

### T10: Runner + `npm run fetch` CLI (first end-to-end slice; depends on T7, T9)
- Files: `src/sources/runner.ts`, `src/sources/runner.test.ts`, `src/scripts/fetch.ts`
- Interface:
  ```ts
  export interface SourceRunSummary extends Omit<FetchResult, "jobs"> { inserted: number; updated: number }
  export async function runSources(opts: { db: Db; http: HttpClient; adapters: AnyAdapter[]; force?: boolean; now?: () => Date; log?: (m: string) => void }): Promise<SourceRunSummary[]>
  ```
- Behavior of `runSources`:
  - **Rate guard:** if `!force` and `lastSuccessfulRunAt` is less than `minIntervalMinutes` ago, don't call `fetch`. Return `status: "skipped"`, record a `skipped` run and log `<id>: skipped (last run <n> min ago)`.
  - Run the adapters concurrently, at most 4 at a time. Implement this with a small queue; don't add a dependency.
  - Build each adapter's `ctx` with `latestPostedAt(db, id)`.
  - After each `runAdapter` finishes, call `upsertJobs` with its jobs and record a run with every count. Error results are recorded with status `error` and nothing is upserted.
  - Results come back in the same order as `adapters`.
- CLI `src/scripts/fetch.ts`:
  - Flags:
    - `--source <id>`: repeatable, also accepts a comma-separated list
    - `--force`
    - Unknown flags or unknown source ids print `Unknown source: <id>. Valid: <ids>` and exit 1.
  - Opens the DB with `openDb({ migrate: true })` and creates the client with `createHttpClient()`.
  - Prints a table with `console.table` and these columns: source, status, fetched, inserted, updated, invalid, filtered, ms, error.
  - Then prints `Total jobs in DB: <n>`.
  - Exit code: 0 if at least one source succeeded or was skipped, otherwise 1.
- Tests first, using an in-memory DB and fake adapters:
  - `skips source inside minInterval unless force`
  - `records error run and continues with other sources`
  - `second run reports inserted 0 and updated N`
- Verify:
  - `npm test` passes.
  - `npm run fetch -- --source remoteok` shows `success` with inserted > 0.
  - Running it again immediately shows `skipped`.
  - `npm run fetch -- --source remoteok --force` shows inserted 0 and updated > 0.
- **Stop here and report to the user before T11.**
- [x] Done

### Board adapters T11–T18 (each depends on T10)
Each one follows T9's pattern:
- one adapter file, one test file and one fixture folder
- add the adapter to `registry.ts`
- fixtures recorded with `curl -A "job-searcher-mvp/0.1" <url>` and trimmed to 3–6 items, including the edge cases named below
- each adapter's `fetch` validates its envelope with Zod and throws on mismatch

Every adapter's tests must include `normalizes a typical item` (asserting every Job field) plus the cases listed. After each one, `npm run fetch -- --source <id>` must show `success`.

### T11: We Work Remotely (`weworkremotely`)
- Name `We Work Remotely`, homepage `https://weworkremotely.com`, `minIntervalMinutes: 60`, `techFilter: false`.
- Feeds (use this constant): `https://weworkremotely.com/categories/` + one of:
  - `remote-programming-jobs.rss`
  - `remote-full-stack-programming-jobs.rss`
  - `remote-back-end-programming-jobs.rss`
  - `remote-front-end-programming-jobs.rss`
  - `remote-devops-sysadmin-jobs.rss`
- `fetch`:
  - `getText` each feed **one after another**.
  - Parse with `rss-parser` (`new Parser({ customFields: { item: ["region", "category"] } })` and `parseString`).
  - Concatenate the items and return them. If one feed fails, log it and continue. Throw only if all of them fail.
  - Fixture files: `test/fixtures/weworkremotely/programming.rss`, with 3 items.
- `itemSchema`: `title`, `link`, `guid` and `pubDate` are strings; `content` or `description` is a string; `region` and `category` are optional strings.
- `normalize`:
  - Split `title` at the first `": "`: the part before is `company`, the rest is `title`. If there's no `": "`, return null.
  - `externalId = guid`, `url = link`, `applyUrl = null`
  - `location = region ?? null`, `remote = true`
  - `tags = normalizeTags([category])`
  - `descriptionHtml = content ?? description`
  - `postedAt = toIsoUtc(pubDate)`
  - Salary fields are null.
- Extra tests: `returns null when title has no company separator`, `dedupes the same guid from two feeds` (via `runAdapter`).
- [x] Done

### T12: Get on Board (`getonboard`)
- Name `Get on Board`, homepage `https://www.getonbrd.com`, `minIntervalMinutes: 60`, `techFilter: false`.
- Categories (constant): `programming, sysadmin-devops-qa, mobile-developer, data-science-analytics, machine-learning-ai, cybersecurity`.
- `fetch`:
  - For each category, page by page from 1:
    `https://www.getonbrd.com/api/v0/categories/<cat>/jobs?per_page=100&page=<n>&expand=%5B%22company%22%5D`
  - Envelope: `{ data: unknown[], meta: { page: number, total_pages: number } }`.
  - Stop when `page >= total_pages` or after 3 pages per category.
  - Make requests one after another.
- `itemSchema`:
  - `id`: string
  - `links.public_url`: string
  - `attributes`:
    - `title`: string
    - `description`, `functions`, `desirable`, `benefits`: string, nullable, optional
    - `remote_modality`: string, nullable
    - `countries`: string[], default []
    - `min_salary` / `max_salary`: number, nullable
    - `published_at`: number
    - `category_name`: string, nullable
    - `company.data.attributes.name`: string, optional
- `normalize`:
  - `externalId = id`, `url = links.public_url`, `applyUrl = null`
  - `company` = the expanded company name, or `"Unknown"`
  - `remote`: `fully_remote` or `remote_local` → true; `hybrid` or `no_remote` → false; anything else → null
  - `location = countries.join(", ") || null`
  - Salary: currency `USD`, period `month`, each value null when null or 0
  - `descriptionHtml`: join the non-empty `description`, `functions`, `desirable` and `benefits` with `\n`
  - `tags = normalizeTags([category_name])`
  - `postedAt = toIsoUtc(published_at)`
- Extra tests: `maps remote modalities`, `uses Unknown when company not expanded`, `stops paging at total_pages` (fake http with 2 pages).
- [x] Done

### T13: Remotive (`remotive`)
- Name `Remotive`, homepage `https://remotive.com`, **`minIntervalMinutes: 360`** (their terms: at most 4 calls a day), `techFilter: true`.
- `fetch`: GET `https://remotive.com/api/remote-jobs`. The envelope is `{ jobs: unknown[] }`, with other keys allowed (`.passthrough()`).
- `itemSchema`:
  - `id`: number
  - `url`, `title`, `company_name`: string
  - `category`: string
  - `tags`: string[], default []
  - `candidate_required_location`: string, default ""
  - `description`: string
  - `publication_date`: string
- `normalize`:
  - `externalId = String(id)`, `applyUrl = null`
  - `remote = true`, `location = candidate_required_location || null`
  - `tags = normalizeTags([...tags, category])`
  - Salary fields are null (their salary is free text)
  - `postedAt = toIsoUtc(publication_date)` (no timezone, so it's treated as UTC)
- Extra tests: `naive publication_date is treated as UTC`.
- [x] Done

### T14: Himalayas (`himalayas`)
- Name `Himalayas`, homepage `https://himalayas.app`, `minIntervalMinutes: 60`, `techFilter: true`.
- `fetch`:
  - Start at `https://himalayas.app/jobs/api?limit=20`, then add `&cursor=<nextCursor>` for each following page.
  - Envelope: `{ jobs: unknown[], nextCursor?: string | null }`.
  - Collect items until any of these happens:
    - there's no `nextCursor`
    - 50 pages have been fetched
    - `ctx.latestPostedAt` isn't null and a page contains an item whose `pubDate` (epoch seconds) is **older** than `latestPostedAt`. Keep that page's items, then stop.
  - Wait 500 ms between pages. Use an injectable `sleep` so tests can make it instant.
- `itemSchema`:
  - `guid`, `title`, `companyName`, `description`, `applicationLink`: string
  - `pubDate`: number
  - `minSalary` / `maxSalary`: number, nullable, optional
  - `currency`: string, nullable, optional
  - `salaryPeriod`: string, nullable, optional
  - `locationRestrictions`, `categories`, `seniority`: string[], default []
- `normalize`:
  - `externalId = guid`, `url = guid`, `applyUrl = applicationLink`
  - `remote = true`, `location = locationRestrictions.join(", ") || null`
  - `salaryCurrency = currency?.toUpperCase() ?? null`, `salaryPeriod = salaryPeriodFrom(salaryPeriod)`
  - `tags = normalizeTags([...categories, ...seniority])`
  - `postedAt = toIsoUtc(pubDate)`
- Extra tests: `stops when a page reaches older jobs than latestPostedAt`, `stops at 50 pages`, `maps hourly salary period`.
- [x] Done

### T15: Jobicy (`jobicy`)
- Name `Jobicy`, homepage `https://jobicy.com`, `minIntervalMinutes: 60`, `techFilter: false`.
- `fetch`: one GET to `https://jobicy.com/api/v2/remote-jobs?count=100&industry=dev`. The envelope is `{ jobs: unknown[] }`, passthrough. No pagination in M1.
- `itemSchema`:
  - `id`: number
  - `url`, `jobTitle`, `companyName`, `jobDescription`, `pubDate`: string
  - `jobGeo`: string, default ""
  - `jobIndustry`, `jobType`: string[], default []
  - `jobLevel`: string, optional
  - `salaryMin` / `salaryMax`: number, optional
  - `salaryCurrency` / `salaryPeriod`: string, optional
- `normalize`:
  - `externalId = String(id)`, `applyUrl = null`
  - `title = decodeEntities(jobTitle)`
  - `remote = true`, `location = jobGeo || null`
  - `tags = normalizeTags([...jobIndustry, ...jobType, jobLevel])`
  - Salary values come from the fields when present, with `salaryPeriod = salaryPeriodFrom(salaryPeriod)` (their value is `yearly`)
  - `postedAt = toIsoUtc(pubDate)`
- Extra tests: `decodes entities in title` (`R&amp;D` → `R&D`), `salary fields null when absent`.
- [x] Done

### T16: Working Nomads (`workingnomads`)
- Name `Working Nomads`, homepage `https://www.workingnomads.com`, `minIntervalMinutes: 60`, `techFilter: true`.
- `fetch`: GET `https://www.workingnomads.com/api/exposed_jobs/` (keep the trailing slash). The envelope is an array.
- `itemSchema`:
  - `url`, `title`, `company_name`, `description`, `pub_date`: string
  - `category_name`: string, default ""
  - `tags`: string (comma-separated), default ""
  - `location`: string, default ""
- `normalize`:
  - `externalId` = the number from `/job/go/(\d+)/` in `url`, or the full `url` if there's no match
  - `applyUrl = null`, `remote = true`, `location = location || null`
  - `tags = normalizeTags([...tags.split(","), category_name])`
  - `postedAt = toIsoUtc(pub_date)`
- Extra tests: `extracts numeric id from url`, `splits comma tags`.
- [x] Done

### T17: Arbeitnow (`arbeitnow`)
- Name `Arbeitnow`, homepage `https://www.arbeitnow.com`, `minIntervalMinutes: 60`, `techFilter: true`.
- `fetch`:
  - GET `https://www.arbeitnow.com/api/job-board-api?page=<n>`, starting at 1.
  - Envelope: `{ data: unknown[], links: { next: string | null } }`, passthrough.
  - Stop when `links.next` is null, after 3 pages, or when a page has an item with `created_at` older than `ctx.latestPostedAt`. Keep that page, as in T14.
  - Requests run one after another.
- `itemSchema`:
  - `slug`, `company_name`, `title`, `description`, `url`: string
  - `remote`: boolean
  - `tags`, `job_types`: string[], default []
  - `location`: string, default ""
  - `created_at`: number
- `normalize`:
  - `externalId = slug`, `applyUrl = null`
  - `descriptionHtml = decodeEntities(description)` (the source is HTML-escaped once)
  - `remote = remote`, `location = location || null`
  - `tags = normalizeTags([...tags, ...job_types])`
  - `postedAt = toIsoUtc(created_at)`
- Extra tests: `decodes escaped description html`, `stops paging when next is null`.
- [x] Done

### T18: HN "Who is hiring?" (`hn-hiring`)
- Name `HN: Who is hiring?`, homepage `https://news.ycombinator.com`, `minIntervalMinutes: 360`, `techFilter: false`.
- `fetch`:
  1. GET `https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=10`. Envelope: `{ hits: { objectID: string, title: string }[] }`.
  2. Pick the first hit whose title starts with `Ask HN: Who is hiring?`. If there isn't one, throw `Error("No Who is hiring thread found")`.
  3. GET `https://hn.algolia.com/api/v1/items/<objectID>`. Envelope: `{ children: unknown[] }`.
  4. Return the children that have a non-empty `text`.
- `itemSchema`: `id`: number, `text`: string, `created_at`: string, `author`: string, nullable.
- `normalize`:
  - **Header line:** take the text before the first `<p>`, run it through `htmlToText`, then split on `|` and trim each part.
  - If there are fewer than 2 parts, return null.
  - `company = parts[0]`, `title = parts[1]`, `location = parts[2] ?? null`.
  - `remote`: true if the header matches `/\bremote\b/i`; false if it matches `/\bon-?site\b/i`; otherwise null.
  - `externalId = String(id)`, `url = https://news.ycombinator.com/item?id=<id>`.
  - `applyUrl` = the first `href="..."` in the text, entity-decoded, or null.
  - `tags = []`, salary fields null.
  - `descriptionHtml = text`, `postedAt = toIsoUtc(created_at)`.
- Fixtures:
  - `test/fixtures/hn-hiring/search.json` (2 hits, including a "Who wants to be hired?" one)
  - `test/fixtures/hn-hiring/item.json` (4 children, including one whose header has no `|`)
- Extra tests: `picks the who-is-hiring thread not who-wants-to-be-hired`, `parses pipe header`, `returns null without pipes`, `detects remote and onsite`, `extracts first href as applyUrl`.
- [x] Done

### T19: Cross-source duplicate marking (depends on T7, T11–T18)
- Files: `src/db/queries.ts` (edit), `src/db/queries.test.ts` (add cases)
- Behavior (inside `upsertJobs`, for **newly inserted** jobs only):
  - Find the oldest existing job where all of these hold:
    - its `source` differs from the new job's
    - `duplicate_of` is null
    - either its `dedupe_key` equals the new key, or both `apply_url` values are non-null and equal
    - its `first_seen_at` is within the last 30 days of `nowIso`
  - If one is found, set the new row's `duplicateOf` to that job's `id`.
  - Never delete rows, and never change the original job.
- Tests first:
  - `marks same company+title from another source as duplicate`
  - `does not mark same-source jobs`
  - `does not mark when original is older than 30 days`
  - `matches on identical applyUrl`
- Verify: `npm test -- src/db` passes.
- [x] Done

### T20: Live checks (depends on T11–T18)
- Files: `src/sources/adapters.live.test.ts`
- Behavior:
  - For each adapter in `registry.ts`, run `it("<id> returns valid jobs")`.
  - Each test calls `runAdapter(adapter, { http: createHttpClient(), latestPostedAt: null, log: console.log })`.
  - It asserts `status === "success"`, `fetched > 0` and `jobs.length > 0`, and that `invalid / fetched < 0.2`.
  - For `remotive`, only assert `status === "success"`, since its free feed is tiny.
  - No DB.
- Verify: `npm run test:live` passes for all 9 sources. If a source fails because its API changed, stop and report; don't loosen the asserts.
- [x] Done

### T21: Wrap-up (depends on all)
- Delete the `> Target setup…` note under Commands in `CLAUDE.md`. That's the only edit to `CLAUDE.md`.
- Tick every M1 item in the root `PLAN.md`.
- Under the Decisions log there, add:
  - `- <date>: M1 done; Remotive kept (12 jobs/day, 6h interval).`
  - The current Himalayas/Arbeitnow page caps, if you changed them. You may only change them after asking.
- Verify: the milestone verification below passes.
- [x] Done

## Milestone verification
1. `npm run lint && npm run typecheck && npm test` all exit 0.
2. `npm run test:live` passes for all 9 sources.
3. Delete `data/jobs.db`, then run `npm run fetch`. Every source shows `success` (or a reported error you've explained), and `Total jobs in DB` is > 500.
4. Run `npm run fetch -- --force` again. Every source shows `inserted` of 0 or close to 0, with most rows counted as `updated`.
5. Run `npm run fetch` without `--force`. Every source shows `skipped`.

## Gotchas
- **Scaffold files.** `create-next-app` may generate `AGENTS.md`/`CLAUDE.md`/`README.md`. Never copy them over the project's files.
- **Synchronous DB.** `better-sqlite3` is synchronous. Don't `await` Drizzle queries in `src/db/` (use `.run()`, `.get()`, `.all()`), and do wrap multi-row writes in `db.transaction`.
- **Remote OK's notice.** Element 0 of its array is a legal notice, not a job.
- **Double-escaped descriptions.** Arbeitnow descriptions are HTML-escaped once (`&lt;div&gt;`). HN text uses `&#x2F;` for `/`.
- **Timestamps.** Unix timestamps from Get on Board, Himalayas, Arbeitnow and Remote OK's `epoch` are in **seconds**, not milliseconds.
- **Remotive dates.** `publication_date` has no timezone. Treat it as UTC.
- **Remotive's limit.** Remotive blocks clients that call more than about 4 times a day. Never lower its `minIntervalMinutes`, and don't run its live test in a loop.
- **Himalayas pages.** Himalayas ignores `limit` above 20. Paginate with `cursor`, not `offset`, which is deprecated.
- **Get on Board company names.** Without `expand=["company"]`, Get on Board returns only a company id.
- **WWR titles.** The company name is inside the title (`Company: Role`).
- **Nothing in this milestone touches the network in `*.test.ts`.** If a test needs data, add a fixture.
- **Fixtures are committed.** Keep them small (3–6 items) and never include anything from `.env`.
- **Attribution.** Store each job's `url` exactly as the source gives it. Remote OK, Remotive, Jobicy and Arbeitnow require a link back, and M4 will render it.

## Open questions / assumptions
- **Dependencies.** The T1 list must be approved by the user before T1 starts. If it isn't, stop.
- **Get on Board salaries.** Assumed to be USD per month. If you find evidence otherwise in the API response, stop and ask.
- **Jobicy filter.** It uses only `industry=dev`. Whether to add other IT industries is undecided; don't add any without asking.
- **Dedupe rule.** It uses company + title (or identical apply URL), **not** location, because location text differs across sources. This changes the root plan's wording on purpose.
- **Tech filter.** The `TECH_KEYWORDS` list is a heuristic. False positives such as "Sales Engineer" are accepted for now; M3 scoring handles them.
- **Incremental fetching.** Himalayas and Arbeitnow stop at the stored `postedAt`, not at the "first known job" the root plan describes. Jobs dropped by the tech filter are never stored, so a known-id check would never trigger.

## Root PLAN.md mapping
| Root M1 item | Tasks |
|---|---|
| Scaffold | T1 |
| `Job` Zod schema + `SourceAdapter` interface | T2, T3 |
| Shared HTTP helper | T4 |
| DB tables + upsert | T6, T7 |
| Fetch runner + CLI | T8, T10 |
| Remote OK … HN adapters | T9, T11–T18 (one item each) |
| Dedupe across sources | T5, T19 |
| Live checks | T20 |
