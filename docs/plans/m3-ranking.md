# M3: Search config, hard rules and local embedding ranking

Base: commit `4745eb6` on branch `feat/m2-companies-ats` (M2, PR #14). Executed with the `execute-plan` skill.

## Goal
`npm run rank` reads the search description (`config/search.md`) and hard rules (`config/preferences.json`). It drops open jobs that contradict a hard rule, embeds the remaining jobs locally (each once, again only if their text changes), and prints the top N jobs by similarity to the search. Nothing is paid and nothing leaves the machine.

## Context
- **Branch:** if PR #14 is merged, create `feat/m3-ranking` from an up-to-date `main`. If it isn't, create it from `feat/m2-companies-ats` (a stacked PR) and retarget it to `main` after #14 merges, as `CLAUDE.md` describes. Run `nvm use` first (Node 22; Node 20 segfaults with this toolchain).
- **Commits:** one per task, with the exact message given in the task, ending with the session's attribution line. Tick the task's `- [ ] Done` in this file in the same commit. Commit this spec (and the `PLAN.md` link) first as `docs(m3): add M3 spec and link it from PLAN.md`.
- Rules from `CLAUDE.md`:
  - TDD for core logic.
  - All DB access goes through `src/db/`. Migrations come only from `npm run db:generate`; never edit `drizzle/` by hand.
  - Never commit `config/search.md` or `config/preferences.json` (gitignored; commit the `*.example.*` files).
  - Unit tests never download or load the embedding model. They use a fake embedder with small fixed vectors. Only `*.live.test.ts` may load the real model.
  - Each job is embedded once, and again only if its text changes.
  - Lint, typecheck and the full test suite must pass before each commit.
- Testing:
  - No `vi.mock` in `src/`. Use in-memory DBs (`openDb({ url: ":memory:", migrate: true })`), dependency injection, and a temporary config directory (`fs.mkdtempSync(path.join(os.tmpdir(), "m3-"))`).
  - Use exact literal expected values; no `expect.any`, `expect.anything` or `arrayContaining`.
- Decisions already made (approved by the user on 2026-11-19):
  - **New dependency** `@huggingface/transformers`, pinned exactly to `4.3.2`. The model is `onnx-community/gte-multilingual-base`, quantized (`dtype: "q8"`), with CLS pooling, normalized, 768 dimensions and no prefixes. It's cached in `data/models/` (gitignored).
  - **Hard rules** in `config/preferences.json` (all optional): allowed `seniority` levels (derived from the title), a yearly `salaryFloor` per currency, `excludeDepartments`, and `excludeTitleKeywords`. **Unknown values pass**: a job is dropped only when its data contradicts a rule.
  - **Embedding happens inside `npm run rank`**, only for open jobs that pass the hard rules. `npm run fetch` is unchanged. The default is `--top 100`.
  - The **embedded text** is the title, a blank line, then `descriptionText`, cut to 6,000 characters (about 1,500 tokens) to bound CPU time. It's re-embedded when `sha256(model + "\n" + text)` changes.
  - The **search description is embedded on every run**. It's a single embedding, so it's never cached and is always current.
  - The **embedding model id** stored with each vector is `onnx-community/gte-multilingual-base:q8`. Changing the model or dtype re-embeds every job.

## Key code
- `src/db/schema.ts`: the `jobs` table (`id`, `title`, `company`, `location`, `url`, `departments` (JSON string[]), `salaryMin`, `salaryMax`, `salaryCurrency`, `salaryPeriod` (`"year" | "month" | "hour" | null`), `descriptionText`, `closedAt`). It imports `index, integer, real, sqliteTable, text, uniqueIndex, type AnySQLiteColumn` from `drizzle-orm/sqlite-core`.
- `src/db/client.ts`: `openDb({ url?, migrate? })` turns `foreign_keys = ON` and runs migrations from `drizzle/`. There are 5 migrations now (`0000`–`0004`).
- `src/db/queries.ts`: `upsertJobs(db, jobs, nowIso, { companyId? })`, which refuses board-source jobs. Tests insert ATS jobs (for example `source: "greenhouse"`) through it.
- `src/db/companies.ts`: `insertOrGetCompany(db, {...}, nowIso)`.
- `src/core/job.ts`: the `Job` type and `salaryPeriodFrom`.
- `src/scripts/cli-errors.ts`: `CliUsageError`.
- `src/scripts/seed-cli.ts` and `src/scripts/seed.ts`: the pattern to copy. `run<X>Cli(argv, deps)` holds the testable logic and returns an exit code; `<x>.ts` is process wiring only and is excluded from coverage in `vitest.config.mts`.
- `vitest.config.mts`: the coverage `exclude` list and thresholds (lines 95, branches 85, functions 90, statements 95). `vitest.live.config.mts` runs `src/**/*.live.test.ts` with a 60 s timeout.
- `.gitignore`: already ignores `/data/`, `/config/search.md` and `/config/preferences.json`.
- `.github/workflows/live-checks.yml`: runs `npm run test:live` nightly.

## Out of scope
- Claude scoring (M4), the UI (M5) and automation (M6).
- Any change to `npm run fetch`, the storage filters, or M2 code beyond the listed files.
- Caching the search embedding, approximate nearest-neighbour indexes, or a similarity cutoff.
- Caching the model in CI.
- The M2 follow-ups listed in PR #14.

## Tasks

### T1: Seniority from the job title
- Depends on: none
- Files: `src/ranking/seniority.ts`, `src/ranking/seniority.test.ts`
- Interfaces:
  ```ts
  export const SENIORITY_LEVELS = ["intern", "junior", "mid", "senior", "staff", "principal", "lead", "manager"] as const;
  export type SeniorityLevel = (typeof SENIORITY_LEVELS)[number];
  export function deriveSeniority(title: string): SeniorityLevel | null;
  ```
- Behavior: lowercase the title and replace `-`, `_` and `/` with spaces. Then test these rules **in this order** (first match wins), each as a whole word or phrase (`(?<![a-z0-9])…(?![a-z0-9])`):
  1. `manager`: manager, head of, director, vp, vice president, cto
  2. `principal`: principal, distinguished
  3. `staff`: staff
  4. `lead`: lead
  5. `senior`: senior, sr, sr.
  6. `mid`: mid, mid level, intermediate
  7. `junior`: junior, jr, jr., entry level, graduate, associate
  8. `intern`: intern, internship, trainee, apprentice

  No match gives `null`.
- Failure cases: an empty title gives `null`. "Internal Tools Engineer" gives `null`, because "intern" only matches as a whole word.
- Tests first (`it.each`, title → expected):
  - `"Senior Full-Stack Engineer"` → `"senior"`
  - `"Sr. Backend Developer"` → `"senior"`
  - `"Staff Software Engineer"` → `"staff"`
  - `"Principal Engineer"` → `"principal"`
  - `"Tech Lead, Frontend"` → `"lead"`
  - `"Senior Engineering Manager"` → `"manager"`
  - `"Head of Engineering"` → `"manager"`
  - `"Mid-Level React Developer"` → `"mid"`
  - `"Junior Node.js Developer"` → `"junior"`
  - `"Associate Software Engineer"` → `"junior"`
  - `"Software Engineering Intern"` → `"intern"`
  - `"Internal Tools Engineer"` → `null`
  - `"Software Engineer"` → `null`
  - `""` → `null`
  - `"Staff Engineer / Tech Lead"` → `"staff"`
- Verify: `npm test -- src/ranking/seniority.test.ts` passes.
- Commit: `feat(m3): derive seniority from job titles (M3 T1)`
- [x] Done

### T2: Config loading and the example files
- Depends on: T1
- Files: `src/ranking/config.ts`, `src/ranking/config.test.ts`, `config/search.example.md`, `config/preferences.example.json`
- Interfaces:
  ```ts
  export class ConfigError extends Error {} // name "ConfigError"
  export const PreferencesSchema: z.ZodType<Preferences>; // z.object({...}).strict()
  export interface Preferences {
    seniority?: SeniorityLevel[];               // non-empty when present
    salaryFloor?: Record<string, number>;       // keys /^[A-Z]{3}$/, values > 0, yearly amounts
    excludeDepartments?: string[];              // non-empty strings
    excludeTitleKeywords?: string[];            // non-empty strings
  }
  export function loadSearchDescription(configDir: string): string;
  export function loadPreferences(configDir: string): { prefs: Preferences; found: boolean };
  ```
- Behavior:
  - `loadSearchDescription` reads `<configDir>/search.md` and returns it trimmed.
  - `loadPreferences` reads `<configDir>/preferences.json`, parses it, and validates it with `PreferencesSchema`.
- Failure cases (exact messages):
  - `search.md` missing: `ConfigError("Missing config/search.md. Copy config/search.example.md to config/search.md and describe the job you want.")`.
  - `search.md` empty or only whitespace: `ConfigError("config/search.md is empty.")`.
  - `preferences.json` missing: `{ prefs: {}, found: false }`, not an error.
  - Invalid JSON: `ConfigError("config/preferences.json is not valid JSON: <JSON.parse message>")`.
  - Schema failure: `ConfigError("config/preferences.json: <issue path joined with '.'>: <issue message>")`, using the first issue.
  - An unknown key fails, because the schema is `.strict()`; that catches typos like `"seniorty"`.
- Example files (committed):
  - `config/search.example.md`: 5–10 lines describing a remote senior full-stack role (TypeScript, React, Next.js, Node.js) that can be done from Argentina, at a product company. Plain text, no personal data.
  - `config/preferences.example.json`:
    ```json
    { "seniority": ["mid", "senior", "staff", "lead"], "salaryFloor": { "USD": 60000, "EUR": 55000 },
      "excludeDepartments": ["Sales", "Marketing", "Customer Success"],
      "excludeTitleKeywords": ["Mobile", "iOS", "Android", "Data Scientist"] }
    ```
- Tests first (each with its own temporary directory):
  - `loads and trims the search description`: `"  Senior React role\n\n"` → `"Senior React role"`.
  - `a missing search.md is a ConfigError with instructions`: the exact message above.
  - `an empty search.md is a ConfigError`.
  - `a missing preferences.json means no rules`: `{ prefs: {}, found: false }`.
  - `loads valid preferences`: the example file's content is returned as an equal object, with `found: true`.
  - `invalid JSON is a ConfigError`: the message starts with `"config/preferences.json is not valid JSON: "`.
  - `an unknown seniority level is a ConfigError`: `{"seniority":["wizard"]}` → the message starts with `"config/preferences.json: seniority.0: "`.
  - `an unknown key is a ConfigError`: `{"seniorty":["senior"]}` gives a `ConfigError`.
  - `a lowercase currency is a ConfigError`: `{"salaryFloor":{"usd":1}}` gives a `ConfigError`.
  - `the committed example files are valid`: `loadPreferences("config")` won't work in CI (the real file is gitignored), so read `config/preferences.example.json` directly and check `PreferencesSchema.safeParse(...).success` is `true`, and that `config/search.example.md` trimmed is non-empty.
- Verify: `npm test -- src/ranking/config.test.ts` passes, and `git check-ignore config/search.md config/preferences.json` prints both paths.
- Commit: `feat(m3): load the search description and hard rules from config (M3 T2)`
- [x] Done

### T3: Hard rules
- Depends on: T1, T2
- Files: `src/ranking/hard-rules.ts`, `src/ranking/hard-rules.test.ts`
- Interfaces:
  ```ts
  export type Exclusion = "title" | "department" | "seniority" | "salary";
  export type RuleInput = { title: string; departments: string[]; salaryMin: number | null; salaryMax: number | null;
    salaryCurrency: string | null; salaryPeriod: string | null };
  export function checkHardRules(job: RuleInput, prefs: Preferences): { pass: true } | { pass: false; reason: Exclusion };
  ```
- Behavior: check the rules in this order and return the first one that fails.
  1. **title:** any `excludeTitleKeywords` entry matches the title (case-insensitive, whole word or phrase: `(?<![\p{L}\p{N}])kw(?![\p{L}\p{N}])` with flags `"iu"`, keyword regex-escaped).
  2. **department:** any `excludeDepartments` entry matches any department, using the same matching.
  3. **seniority:** `prefs.seniority` is set, `deriveSeniority(title)` is not `null`, and the level isn't in the list.
  4. **salary:** `floor = prefs.salaryFloor?.[salaryCurrency]`. If there's no floor for that currency, or both salary values are `null`, the job passes. Otherwise `best = salaryMax ?? salaryMin`, and `yearly = best × (month: 12, hour: 2080, year or null: 1)`. It fails when `yearly < floor`.
- Failure cases: empty `prefs` means every job passes. An unknown currency (no floor for it) passes. A salary with no period counts as yearly.
- Tests first (`it.each`; the base job is `{ title: "Senior React Developer", departments: ["Engineering"], salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null }`, with overrides per row):
  - `{}` prefs → `{ pass: true }`
  - title keyword: prefs `{ excludeTitleKeywords: ["React"] }` → `{ pass: false, reason: "title" }`; `["Mobile"]` on "Senior React Developer" → pass
  - department: `{ excludeDepartments: ["engineering"] }` → `"department"`
  - seniority: `{ seniority: ["mid"] }` → `"seniority"`; `{ seniority: ["senior"] }` → pass; the title "React Developer" (unknown level) with `{ seniority: ["mid"] }` → pass
  - salary: `{ salaryFloor: { USD: 60000 } }` with `salaryMax: 50000, USD, year` → `"salary"`; with `salaryMin: 50000, salaryMax: 70000` → pass; `salaryMax: 6000, period "month"` → pass (72,000); `salaryMax: 25, period "hour"` → `"salary"` (52,000); currency `"EUR"` with only a USD floor → pass; no salary → pass; `salaryMax: 59999, period null` → `"salary"`
  - order: a job failing both title and salary → `"title"`
- Verify: `npm test -- src/ranking/hard-rules.test.ts` passes.
- Commit: `feat(m3): apply hard rules where unknown values pass (M3 T3)`
- [x] Done

### T4: The job_embeddings table
- Depends on: none
- Files: `src/db/schema.ts`, `src/db/client.test.ts`, plus the migration `npm run db:generate` creates (`drizzle/0005_*.sql`, `drizzle/meta/0005_snapshot.json`, `drizzle/meta/_journal.json`)
- Interfaces (`schema.ts`; add `blob` to the `sqlite-core` import):
  ```ts
  export const jobEmbeddings = sqliteTable("job_embeddings", {
    jobId: integer("job_id").primaryKey().references(() => jobs.id),
    model: text("model").notNull(),
    textHash: text("text_hash").notNull(),
    vector: blob("vector", { mode: "buffer" }).notNull(), // Float32Array bytes, little-endian
    createdAt: text("created_at").notNull(),
  });
  ```
- Behavior: run `npm run db:generate`. Expect exactly one new migration that only creates `job_embeddings` (`CREATE TABLE`, with no change to other tables). If it touches any other table, stop and ask. Commit the generated files as they are.
- Failure cases: none at runtime. Jobs are never deleted (they're compacted), so no `ON DELETE` is needed.
- Tests first (`client.test.ts`): add `creates job_embeddings and stores a vector blob`. Insert a job, then a `jobEmbeddings` row with `vector: Buffer.from(new Float32Array([0.5, -1]).buffer)`. Reading it back as a copy, `Array.from(new Float32Array(row.vector.buffer.slice(row.vector.byteOffset, row.vector.byteOffset + row.vector.byteLength)))` gives `[0.5, -1]`.
- Verify: `npm test -- src/db/client.test.ts` passes, `npx drizzle-kit generate` then reports "No schema changes", and `ls drizzle/*.sql | wc -l` is `6`.
- Commit: `feat(m3): add the job_embeddings table (M3 T4)`
- [x] Done

### T5: Ranking queries
- Depends on: T4
- Files: `src/db/ranking.ts`, `src/db/ranking.test.ts`
- Interfaces:
  ```ts
  export type RankableJob = { id: number; title: string; company: string; location: string | null; url: string;
    departments: string[]; salaryMin: number | null; salaryMax: number | null; salaryCurrency: string | null;
    salaryPeriod: string | null; descriptionText: string };
  export type StoredEmbedding = { model: string; textHash: string; vector: Float32Array };
  export function listOpenJobsForRanking(db: Db): RankableJob[];                 // closedAt IS NULL, ordered by id
  export function getEmbeddings(db: Db, jobIds: number[]): Map<number, StoredEmbedding>;
  export function saveEmbeddings(db: Db, rows: { jobId: number; model: string; textHash: string; vector: Float32Array }[], nowIso: string): void;
  ```
- Behavior:
  - `saveEmbeddings` writes all rows in one transaction, inserting or replacing on `job_id` (`onConflictDoUpdate`, which also updates `createdAt`).
  - Vectors are stored as `Buffer.from(v.buffer, v.byteOffset, v.byteLength)`. They're read back as a **copy**: `new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))`, because SQLite buffers may not be 4-byte aligned.
  - `getEmbeddings([])` returns an empty `Map` without running a query.
- Failure cases: closed jobs are never listed. An id without an embedding is simply missing from the map.
- Tests first:
  - `lists only open jobs, ordered by id, with the ranking fields`: 2 open jobs and 1 closed (closed with `markClosedJobs`). Assert the exact `RankableJob` objects for the 2 open ones.
  - `saves and reads back embeddings`: save `[0.25, 0.5, -0.75]` for job 1. `getEmbeddings(db, [1, 2])` has `size === 1`, and job 1 maps to `{ model: "m", textHash: "h", vector: Float32Array [0.25, 0.5, -0.75] }` (compare with `Array.from(vector)`).
  - `saving again replaces the row`: a second save with hash `"h2"` and vector `[1]` gives exactly `{ textHash: "h2", vector: [1] }` when read.
  - `getEmbeddings with no ids returns an empty map`.
- Verify: `npm test -- src/db/ranking.test.ts` passes.
- Commit: `feat(m3): queries for open jobs and stored embeddings (M3 T5)`
- [x] Done

### T6: Embedding text and vectors
- Depends on: none
- Files: `src/ranking/vectors.ts`, `src/ranking/vectors.test.ts`
- Interfaces:
  ```ts
  export const EMBED_MAX_CHARS = 6000;
  export function buildEmbeddingText(job: { title: string; descriptionText: string }): string;
  export function textHash(model: string, text: string): string;   // sha256 hex of `${model}\n${text}`, node:crypto
  export function cosine(a: Float32Array, b: Float32Array): number;
  ```
- Behavior:
  - `buildEmbeddingText` gives `` `${title.trim()}\n\n${descriptionText.trim()}`.trim() ``, then `.slice(0, EMBED_MAX_CHARS)`.
  - `cosine` gives `dot / (|a| × |b|)`, or `0` if either norm is 0.
- Failure cases: `cosine` with different lengths throws `Error("cosine: vectors have different lengths (3 vs 2)")`. An empty description gives just the title.
- Tests first:
  - `buildEmbeddingText`: `{ title: " Dev ", descriptionText: " Build things. " }` → `"Dev\n\nBuild things."`; an empty description → `"Dev"`; a 10,000-character description gives length `6000`.
  - `textHash`: equal inputs give equal hashes; a different model or text gives a different hash; `textHash("m", "t")` equals the literal sha256 hex of `"m\nt"` (compute it once in the test with `node:crypto` and assert the 64-character string).
  - `cosine`: `[1,0]·[1,0]` → `1`; `[1,0]·[0,1]` → `0`; `[1,0]·[-1,0]` → `-1`; a zero vector → `0`; different lengths throw the exact message.
- Verify: `npm test -- src/ranking/vectors.test.ts` passes.
- Commit: `feat(m3): embedding text, text hash and cosine similarity (M3 T6)`
- [x] Done

### T7: Embed jobs once, again only when the text changes
- Depends on: T5, T6
- Files: `src/ranking/embedder.ts`, `src/ranking/embed-jobs.ts`, `src/ranking/embed-jobs.test.ts`, `src/test-utils/fake-embedder.ts`
- Interfaces:
  ```ts
  // embedder.ts
  export interface Embedder { readonly model: string; readonly dimensions: number; embed(texts: string[]): Promise<Float32Array[]> }
  // embed-jobs.ts
  export async function embedJobs(db: Db, embedder: Embedder, jobs: RankableJob[],
    opts: { nowIso: string; batchSize?: number; log?: (m: string) => void }
  ): Promise<{ vectors: Map<number, Float32Array>; embedded: number; reused: number }>;
  // test-utils/fake-embedder.ts
  export function createFakeEmbedder(opts?: { model?: string; fail?: (callIndex: number) => boolean }): Embedder & { calls: string[][] };
  ```
- Behavior (`embedJobs`):
  ```
  stored = getEmbeddings(db, jobs.map(j => j.id))
  for each job: text = buildEmbeddingText(job); hash = textHash(embedder.model, text)
    if stored has a row with model === embedder.model and textHash === hash → reuse its vector
    else → queue (job, text, hash)
  for each batch of `batchSize` (default 16) queued items:
    vectors = await embedder.embed(batch texts)
    check: vectors.length === batch length, and every vector.length === embedder.dimensions
    saveEmbeddings(db, batch rows, nowIso)            // each batch is saved before the next starts
    log(`embed: ${done}/${queued}`)
  return { vectors (reused + new, keyed by job id), embedded: queued count, reused: reused count }
  ```
- Fake embedder: `dimensions = 3`. Each text maps to `[count of "react", count of "node", count of "python"]` (case-insensitive), plus `1e-6` on every axis so no vector is all zeros, then normalized. It records each call's texts in `calls`. When `fail(callIndex)` is true it throws `new Error("model crashed")`. The default `model` is `"fake-1"`.
- Failure cases:
  - The embedder throws: `embedJobs` rejects with that error. Batches saved before it stay saved, so the next run resumes.
  - The wrong number of vectors: throw `Error("embedder returned 1 vectors for 2 texts")`, filling in the counts.
  - The wrong dimensions: throw `Error("embedder returned a vector of length 2, expected 3")`.
  - An empty `jobs` list: `{ vectors: new Map(), embedded: 0, reused: 0 }`, and the embedder is never called.
- Tests first (an in-memory DB with jobs inserted via `upsertJobs` as `source: "greenhouse"`):
  - `embeds every new job and stores it`: 3 jobs → `embedded: 3, reused: 0`; `getEmbeddings` has 3 rows.
  - `a second run reuses every vector and calls the embedder 0 times`.
  - `a changed description is embedded again`: change one job's `descriptionText` (re-upsert) → `embedded: 1, reused: 2`.
  - `a different model embeds everything again`: `createFakeEmbedder({ model: "fake-2" })` → `embedded: 3`.
  - `embeds in batches`: 17 jobs with `batchSize: 16` → `calls.length === 2`, with batch sizes `[16, 1]`.
  - `an embedder failure keeps earlier batches`: 17 jobs, `fail: (i) => i === 1` → it rejects with `"model crashed"`, and `getEmbeddings` has 16 rows.
  - `wrong vector count and wrong dimensions throw`: use a hand-written embedder that returns too few vectors, and another that returns 2-length vectors. Expect the exact messages.
- Verify: `npm test -- src/ranking/embed-jobs.test.ts` passes.
- Commit: `feat(m3): embed each job once and again only when its text changes (M3 T7)`
- [x] Done

### T8: Ranking
- Depends on: T3, T6
- Files: `src/ranking/rank.ts`, `src/ranking/rank.test.ts`
- Interfaces:
  ```ts
  export function applyHardRules<J extends RuleInput>(jobs: J[], prefs: Preferences):
    { kept: J[]; excluded: Record<Exclusion, number> };
  export function rankJobs<J extends { id: number }>(jobs: J[], vectors: Map<number, Float32Array>,
    searchVector: Float32Array, topN: number): { job: J; similarity: number }[];
  ```
- Behavior:
  - `applyHardRules` keeps the input order and counts every `Exclusion` key, including zeros.
  - `rankJobs` scores every job that has a vector with `cosine(vector, searchVector)` and skips jobs without one. It sorts by similarity descending, then `id` ascending for ties, and takes the first `topN`.
- Failure cases: no jobs gives `[]`. `topN` larger than the count returns everything. A job missing from `vectors` is skipped silently (only possible if embedding failed partway).
- Tests first:
  - `applyHardRules counts each exclusion`: 4 jobs, one per reason, plus 1 that passes → `kept` has the passing one; `excluded` equals `{ title: 1, department: 1, seniority: 1, salary: 1 }`.
  - `applyHardRules with no prefs keeps everything`: `excluded` equals `{ title: 0, department: 0, seniority: 0, salary: 0 }`.
  - `ranks by similarity, highest first`: vectors `{1: [1,0], 2: [0.6,0.8], 3: [0,1]}` with search `[1,0]` → ids `[1, 2, 3]`, similarities `[1, 0.6, 0]` (use `toBeCloseTo(…, 6)`).
  - `breaks ties by id`: two jobs with equal vectors → the lower id first.
  - `takes the top N`: `topN: 2` → 2 results.
  - `skips jobs without a vector`.
- Verify: `npm test -- src/ranking/rank.test.ts` passes.
- Commit: `feat(m3): apply hard rules and rank jobs by cosine similarity (M3 T8)`
- [x] Done

### T9: The Transformers.js embedder
- Depends on: T7
- Files: `package.json`, `package-lock.json`, `src/ranking/transformers-embedder.ts`, `src/ranking/transformers-embedder.live.test.ts`, `vitest.config.mts`
- Behavior:
  - `npm install --save-exact @huggingface/transformers@4.3.2` (approved). Confirm `package.json` has `"@huggingface/transformers": "4.3.2"` with no `^`.
  - Interface:
    ```ts
    export const EMBEDDING_MODEL = "onnx-community/gte-multilingual-base";
    export const EMBEDDING_DTYPE = "q8";
    export async function createTransformersEmbedder(opts?: { cacheDir?: string }): Promise<Embedder>;
    ```
  - Use a **dynamic** `await import("@huggingface/transformers")` inside the function, so nothing loads it at module import time and unit tests never touch it.
  - Set `env.cacheDir = opts?.cacheDir ?? "data/models"`.
  - Create `pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: EMBEDDING_DTYPE })`.
  - `embed(texts)`: `await extractor(texts, { pooling: "cls", normalize: true })`, then `.tolist()` to `number[][]`, then each row to a `Float32Array`.
  - `model` is `` `${EMBEDDING_MODEL}:${EMBEDDING_DTYPE}` `` and `dimensions` is `768`.
  - Add `"src/ranking/transformers-embedder.ts"` to the coverage `exclude` list, with the comment `// loads the real model; covered by the live check`.
- Failure cases: a download failure or a model error rejects, and the caller (T10) reports it. If version 4.3.2 names these options differently (`dtype`, `pooling`, `normalize`, `env.cacheDir`, `.tolist()`), use the 4.3.2 equivalents with the **same meaning** and list them in the commit body. If CLS pooling or the `q8` dtype isn't available for this model, stop and ask.
- Tests first (`transformers-embedder.live.test.ts`, run only by `npm run test:live`; give it a 600,000 ms timeout because the first run downloads about 340 MB): `embeds English and Spanish into the same space`. Embed `["Senior React developer, remote", "Desarrollador React senior, remoto", "Experienced line cook for a busy restaurant"]`. Expect 3 vectors of length 768, each with a norm within `1e-3` of 1, and `cosine(en, es) > cosine(en, cook)`.
- Verify: `npm test` passes (the live test isn't part of it). Then run `npx vitest run --config vitest.live.config.mts src/ranking/transformers-embedder.live.test.ts` once, so you don't hit the board APIs. It passes, and `ls data/models` shows the cached model.
- Commit: `feat(m3): local embeddings with Transformers.js and gte-multilingual-base (M3 T9)`
- [ ] Done

### T10: `npm run rank` logic
- Depends on: T2, T5, T7, T8
- Files: `src/scripts/rank-cli.ts`, `src/scripts/rank-cli.test.ts`
- Interfaces:
  ```ts
  export function parseRankArgs(argv: string[]): { top: number };   // default 100
  export interface RankCliDeps {
    openDb: () => Db;                                   // called only after config is valid
    createEmbedder: () => Promise<Embedder>;            // called only if there are jobs to rank
    configDir?: string;                                 // default "config"
    now?: () => Date;
    out: { log(m: string): void; error(m: string): void; table(rows: Array<Record<string, string | number>>): void };
  }
  export async function runRankCli(argv: string[], deps: RankCliDeps): Promise<number>;
  ```
- Behavior, in order:
  1. Parse the arguments. `--top N` needs an integer ≥ 1, otherwise `CliUsageError("Missing or invalid value for --top")`; any other argument gives `CliUsageError("Unknown option: <arg>")`. On a usage error: `out.error(message)`, return `1`.
  2. Load `search.md` and the preferences. On a `ConfigError`: `out.error(message)`, return `1`, without opening the DB. If there's no preferences file, log `No config/preferences.json: no hard rules applied`.
  3. `jobs = listOpenJobsForRanking(db)`. If it's empty, log `No open jobs to rank. Run npm run fetch first.` and return `0` without creating the embedder.
  4. `{ kept, excluded } = applyHardRules(jobs, prefs)`, then log `` `Open jobs: ${jobs.length}, after hard rules: ${kept.length} (excluded: title ${t}, department ${d}, seniority ${s}, salary ${sal})` ``.
  5. `embedder = await createEmbedder()`, `searchVector = (await embedder.embed([search]))[0]`, `{ vectors, embedded, reused } = await embedJobs(db, embedder, kept, { nowIso, log: out.log })`. Then log `` `Embedded ${embedded} new or changed jobs, reused ${reused}` ``.
  6. `ranked = rankJobs(kept, vectors, searchVector, top)`. Call `out.table` with rows `{ rank: i + 1, similarity: Math.round(sim * 1000) / 1000, title, company, location: location ?? "", url }`, then log `` `Showing ${ranked.length} of ${kept.length}` ``. Return `0`.
- Failure cases: if creating the embedder, embedding the search, or `embedJobs` throws, call `out.error(\`Embedding failed: ${name}: ${message}\`)` and return `1`. Batches saved so far stay saved.
- Tests first (a temporary config dir, an in-memory DB, and `createFakeEmbedder`; jobs via `upsertJobs` with `source: "greenhouse"`). The search is `"React and Node developer"`. The jobs:
  - A: "Senior React Developer", "React and Node"
  - B: "Senior Python Developer", "Python"
  - C: "Senior Node Engineer", "Node"
  - D: "Mobile Developer", "React"
  - E: closed, "Senior React Developer"

  Prefs: `{ "excludeTitleKeywords": ["Mobile"] }`.
  - `ranks open jobs that pass the hard rules`: returns `0`. The logs include `"Open jobs: 4, after hard rules: 3 (excluded: title 1, department 0, seniority 0, salary 0)"` and `"Embedded 3 new or changed jobs, reused 0"`. The table titles in order are `["Senior React Developer", "Senior Node Engineer", "Senior Python Developer"]`, and the last log is `"Showing 3 of 3"`.
  - `a second run reuses every embedding`: logs `"Embedded 0 new or changed jobs, reused 3"`.
  - `--top 1 shows one job`: the table has 1 row, and the log says `"Showing 1 of 3"`.
  - `a missing search.md fails before opening the DB`: returns `1`, `errors[0]` is the exact `ConfigError` message, and the `openDb` and `createEmbedder` spies weren't called.
  - `invalid preferences fail before opening the DB`: returns `1`.
  - `no preferences file applies no rules`: logs `"No config/preferences.json: no hard rules applied"` and `"Open jobs: 4, after hard rules: 4 (excluded: title 0, department 0, seniority 0, salary 0)"`.
  - `no open jobs returns 0 without loading the model`: returns `0`, logs `"No open jobs to rank. Run npm run fetch first."`, and `createEmbedder` wasn't called.
  - `an embedder failure returns 1`: `createFakeEmbedder({ fail: () => true })` → `errors` equals `["Embedding failed: Error: model crashed"]`.
  - `rejects bad arguments` (`it.each`): `["--top"]`, `["--top", "0"]` and `["--top", "x"]` give `"Missing or invalid value for --top"`; `["--bogus"]` gives `"Unknown option: --bogus"`. All return `1` without opening the DB.
- Verify: `npm test -- src/scripts/rank-cli.test.ts` passes.
- Commit: `feat(m3): npm run rank logic: hard rules, embeddings and top N (M3 T10)`
- [ ] Done

### T11: Wire up `npm run rank`
- Depends on: T9, T10
- Files: `src/scripts/rank.ts`, `package.json`, `vitest.config.mts`
- Behavior:
  - `rank.ts` is process wiring only, like `seed.ts`: `runRankCli(process.argv.slice(2), { openDb: () => openDb({ migrate: true }), createEmbedder: () => createTransformersEmbedder(), out: { log: console.log, error: console.error, table: (r) => console.table(r) } })`, followed by `process.exit(code)`. An uncaught error is printed and exits `1`.
  - `package.json` gets `"rank": "tsx src/scripts/rank.ts"`.
  - The coverage `exclude` list gets `"src/scripts/rank.ts", // process wiring only; the logic lives in rank-cli.ts`.
- Failure cases: handled by `runRankCli`.
- Tests first: none (wiring only). This is checked by the real run below.
- Verify: `npm test`, lint and typecheck pass. `npm run rank -- --bogus; echo $?` prints `Unknown option: --bogus`, then `1`.
- Commit: `feat(m3): add npm run rank (M3 T11)`
- [ ] Done

### T12: Real run and docs
- Depends on: T11
- Files: `CLAUDE.md`, `PLAN.md`
- Behavior:
  1. If `config/search.md` doesn't exist, copy `config/search.example.md` to it and **tell the user** that the results reflect the example search. Never commit it.
  2. Run `npm run rank` (the first run downloads the model and embeds every eligible job), then run it again. Record:
     - the duration of both runs (`time npm run rank`);
     - the "Open jobs … after hard rules …" line;
     - the "Embedded …" line for both runs (the second must say `Embedded 0 new or changed jobs, reused <n>`);
     - the top 10 titles and companies.
  3. `CLAUDE.md` Commands: move `npm run rank` out of "Planned" and write `Rank jobs: \`npm run rank [-- --top N]\` (embeds new or changed open jobs locally, then prints the best matches)`. Make no other `CLAUDE.md` edits.
  4. `PLAN.md`: mark M3 `(done)` and M4 `(current)`. Add `Detailed spec: [docs/plans/m3-ranking.md](docs/plans/m3-ranking.md)` under M3 if it's missing. Append to the decisions log: `- <date>: M3 done: <open jobs> open jobs, <kept> after hard rules; first rank <time> (model download + <n> embeddings), second <time>; Transformers.js 4.3.2 pinned; hard rules: seniority, salary floor per currency, excluded departments and title keywords.`
- Verify: the milestone verification below passes.
- Commit: `docs(m3): wrap up M3: rank command, plan status and decisions log (M3 T12)`
- [ ] Done

## Milestone verification
1. `nvm use && npm run lint && npm run typecheck && npm test && npm run test:coverage` all pass, including the coverage thresholds.
2. `grep -rn "vi.mock" src/` and `grep -rn "expect.any\|expect.anything\|arrayContaining" src/sources/ src/ranking/` print nothing.
3. `npx drizzle-kit generate` reports "No schema changes", and `ls drizzle/*.sql | wc -l` is `6`.
4. `git ls-files config/` lists only `config/search.example.md` and `config/preferences.example.json`.
5. `npm run rank` works on the real DB as described in T12. The second run embeds 0 jobs. The top results read as plausible matches for the search.
6. `git log --oneline` shows one commit per task.

## Gotchas
- **No model in unit tests.** Nothing in `src/` except `transformers-embedder.ts` (and its live test) may import `@huggingface/transformers`. `rank-cli.ts` receives an embedder through `createEmbedder`.
- **CommonJS project.** The package has no top-level await. The dynamic `import()` inside an async function works under `tsx` and Vitest. Don't add `"type": "module"`.
- **Float32 buffers.** Always copy when reading a vector back from SQLite (T5). A `Float32Array` view over an unaligned `Buffer` offset throws.
- **CI:** `live-checks.yml` will download the model on its nightly run (about 340 MB). That's accepted; caching it in CI is out of scope.
- **Hard rules run before embedding**, so a job dropped by a rule is never embedded. If a rule is loosened later, those jobs get embedded on the next run. That's intended.
- **Closed jobs are compacted**: their descriptions are dropped after 30 days, but they're never ranked, so their embeddings stay as they were. A reopened job gets its description back and the same text hash, so it's reused.
- **`search.md` is personal.** Read it at runtime only. Never log its content and never commit it.

## Open questions / assumptions
None. The dependency, the hard-rule set, embedding inside `rank` and the default `--top 100` were approved on 2026-11-19. Stop and ask if the Transformers.js 4.3.2 API can't provide CLS pooling with `q8` for this model.
