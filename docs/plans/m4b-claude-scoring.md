# M4b: Claude scoring (on the owner's Claude plan, through Claude Code)

Base: the last commit of M4a ([m4a-posting-groups.md](m4a-posting-groups.md)). M4a must be fully done first. Executed with the `execute-plan` skill.

## Goal
`npm run score` has Claude score the best-ranked open postings that have no score yet: 0–100 plus short reasons, stored once per posting, never re-scored. `npm run score -- --next` scores the next page down the ranking. `--dry-run` shows what would be sent, without calling Claude.

Claude runs through the **Claude Code CLI** (`claude -p`), logged in with the owner's claude.ai account. Scoring therefore uses the owner's **Claude Pro plan** and its usage limits. There's no API key and no per-token billing.

## Context
- Branch:
  - If M4a's PR (`feat/m4a-posting-groups`) is merged, run `git switch main && git pull && git switch -c feat/m4b-claude-scoring`.
  - Otherwise run `git switch feat/m4a-posting-groups && git switch -c feat/m4b-claude-scoring` (a stacked PR: retarget it to `main` before merging, per `CLAUDE.md`).
  - Run `nvm use` first (Node 26, from `.nvmrc`).
- Commits: one per task, with the exact message given, ending with the session's attribution line. Tick the task's `- [ ] Done` in this file in the same commit.
- Rules from `CLAUDE.md`, as T11 updates them for this design:
  - TDD.
  - All DB access goes through `src/db/`.
  - Never edit `drizzle/` by hand (generate migrations).
  - Never read or commit `.env*`.
  - Claude, on the owner's Claude plan, is the only paid service.
  - Only open jobs that passed the filters and embedding ranking go to Claude, and a posting that already has a score is never sent again.
  - The search description (which states the owner's location) goes only to Claude.
  - Run lint, typecheck and the full test suite before every commit.
- Testing:
  - Vitest, no `vi.mock` (`vi.fn` is fine), exact literal values.
  - Unit tests never run the real `claude`. They use a fake scorer, a fake runner returning the recorded output in `test/fixtures/claude-cli/`, or `node` running a fixture script in place of `claude`.
  - The one real call lives in a `*.live.test.ts` file, run by `npm run test:live` only.
- Decisions already made:
  - **Claude through Claude Code, on the owner's Pro plan (owner's decision).** No `@anthropic-ai/sdk` dependency and no `ANTHROPIC_API_KEY`.
    - Each batch is one `claude -p` process. The prompt is the last argument; the instructions plus the search description go in `--system-prompt`.
    - Output is `--output-format json` with `--json-schema`, so the answer arrives in the result's `structured_output` field.
    - Verified on 2026-11-24 with Claude Code 2.1.322. The result JSON has `type: "result"`, `subtype`, `is_error`, `result`, `structured_output`, `stop_reason`, `usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`), `modelUsage` and `total_cost_usd`.
    - The `total_cost_usd` is an API-equivalent estimate; a Pro plan doesn't bill it.
  - **The `claude` process is isolated.** Every call:
    - runs in a fresh empty temp directory (no project `CLAUDE.md`, nothing from the repo);
    - runs without `ANTHROPIC_API_KEY` in its environment, so it can't fall back to API billing;
    - passes `--tools ""` (no tools), `--strict-mcp-config` (no MCP connectors, such as the owner's Gmail or Drive), `--setting-sources ""` (no user or project settings or hooks) and `--no-session-persistence`.
    - It must **never** use `--bare`: bare mode ignores the claude.ai login and only accepts an API key.
  - **Login check:** `claude auth status` prints JSON. The scorer requires `loggedIn: true` and `authMethod: "claude.ai"`. Anything else stops the run before the DB is opened, with a message telling the owner to run `claude auth login`.
  - **Default model `claude-haiku-5-5` (owner's choice)**, with `--model <id>` to try others; it's passed to `claude --model`.
  - **Prompt caching:** Claude Code caches the prompt prefix on its own (the 2026-11-24 test showed `cache_creation_input_tokens`). The system prompt is byte-stable within a run, so later batches can hit the cache.
  - **Batches:** 10 jobs per call (`SCORE_BATCH_SIZE`). Each description is trimmed to 4,000 characters (`SCORE_MAX_CHARS`). Scores are saved after each batch, so an interrupted run keeps its work. Calls run one at a time.
  - **One score per posting.** `job_scores` is keyed by `job_id`. A posting counts as scored when any job in its group (`jobs.group_id`, from M4a) has a score. Scores store the model, a SHA-256 of the search text, and the date. A changed `search.md` never re-scores anything.
  - **Which jobs get scored:**
    - The candidates are the open postings that pass the current rules, ranked by similarity, as in `npm run rank`.
    - Default mode scores the unscored postings among ranking positions 1..`count` (default 100), so a daily run only scores new arrivals in the top.
    - `--next` scores the first `count` unscored postings in rank order, wherever they are.
  - **Location variants (owner's decision):** M4a groups one company's postings with the same description and different titles, such as "…(ARG/UY based only)" and "…(BR based only)". Each job sent to Claude lists the other open jobs of its group under "Also listed as", and the instructions say a job counts as eligible when any variant is.
  - **Location:** the owner's location is in `config/search.md` ("…that I can do from Argentina" in the example). The instructions tell Claude to judge eligibility against the search description, so no location is hard-coded.
  - **Failures:**
    - These stop the run with exit 1, and earlier batches stay saved:
      - `claude` exits non-zero;
      - it returns `is_error: true` (for example, the plan's usage limit is reached);
      - it times out (5 minutes per call);
      - it can't be started.
    - These leave the batch's jobs unscored for a later run, and the run continues (logged):
      - a refusal;
      - a `structured_output` that doesn't match the schema;
      - jobs missing from the answer.
  - **Usage limits are the cap.** No money is spent. If a run hits the plan's limit, it stops and the rest waits for the next run.

## Key code
- `PLAN.md`, M4 section: the requirements this spec implements (top N default 100, `--next`, eligibility, stored model/hash/date, cost levers, a live check).
- `src/scripts/rank-cli.ts` (after M4a) is the template for the score CLI:
  - `parseRankArgs`, and `RankCliDeps { openDb, createEmbedder, configDir?, now?, out: { log, error, table } }`.
  - It loads `loadSearchDescription(configDir)`, then `loadJobFilterRules(configDir)` (a `ConfigError` → `out.error`, return 1; `fromExample` → log `No config/job-filter-rules.json: using config/job-filter-rules.example.json`).
  - It then runs `openDb`, `ensureJobGroups`, `listOpenJobsForRanking(db, (job) => checkJobRules(job, rules).pass)`, the embedder (on failure: `Could not load the embedding model: …`), then `embedJobs` + `rankJobs` (on failure: `Ranking failed: …`).
  - Errors are formatted by the local `errorText`.
- `src/scripts/cli-errors.ts`: `CliUsageError`.
- `src/scripts/rank.ts`: process wiring only (`runRankCli(process.argv.slice(2), {...}).then((code) => process.exit(code), …)`).
- `src/db/ranking.ts` (after M4a):
  - `RankableJob` has 12 fields (`id, title, company, location, url, departments, tags, salaryMin, salaryMax, salaryCurrency, salaryPeriod, descriptionText`).
  - `listOpenJobsForRanking(db, keep)` returns one job per group; the row's `groupId` is selected internally and stripped.
  - `countOpenPostings(db)`, and `getEmbeddings` (an example of chunked `inArray` lookups).
- `src/db/groups.ts` (M4a): `ensureJobGroups(db): number`.
- `src/db/schema.ts`: the `jobs` table (with `groupId` after M4a) and `jobEmbeddings` (an example of a table keyed by `jobId` with `.references(() => jobs.id)`).
- `src/ranking/embedder.ts` (the `Embedder` interface) and `src/test-utils/fake-embedder.ts` (`createFakeEmbedder()`): the pattern for the `Scorer` interface and the fake scorer.
- `src/ranking/rank.ts`: `rankJobs(jobs, vectors, searchVector, topN)` returns `{ job, similarity }[]`, best first, ties by id.
- `src/ranking/transformers-embedder.live.test.ts` and `vitest.live.config.mts` (includes `src/**/*.live.test.ts`): the live-check pattern.
- `src/scripts/rank-cli.test.ts`:
  - Temp-dir config (`search.md` = `"React and Node developer\n"`, `job-filter-rules.json` via `writeRules`), an in-memory DB and the fake embedder.
  - It stores four open greenhouse Acme jobs (React, Python, Node, Mobile) with an Acme `companyId`. Their ranking order with the fake embedder is React, Mobile, Node, Python.
- The `claude` CLI (`claude --help`): `-p/--print`, `--model`, `--output-format json`, `--json-schema <schema>`, `--system-prompt <prompt>`, `--tools ""`, `--strict-mcp-config`, `--setting-sources <list>`, `--no-session-persistence`, and `auth status` (prints JSON with `loggedIn` and `authMethod`).

## Out of scope
- The Anthropic API / SDK backend. The `Scorer` interface leaves room to add it later as another implementation.
- Running `claude` calls in parallel.
- Re-scoring, deleting scores, or scoring closed jobs.
- A UI (M5), or a command that lists stored scores (M5 shows them).
- Changing ranking, grouping, embeddings, adapters or the filter rules.

## Tasks

### T1: Run the Claude Code CLI safely
- Depends on: none
- Files: `src/ai/claude-cli.ts` (new), `src/ai/claude-cli.test.ts` (new), `test/fixtures/claude-cli/fake-claude.mjs` (new)
- Interfaces:
  ```ts
  export type ClaudeCliResult = { stdout: string; stderr: string; exitCode: number | null };
  /** Runs the CLI with these arguments and resolves with its output. Rejects only when it can't start or times out. */
  export type ClaudeCliRunner = (args: string[]) => Promise<ClaudeCliResult>;
  /**
   * Spawns `command` (default "claude") in a fresh empty temp dir, without ANTHROPIC_API_KEY in its environment,
   * so it uses the owner's Claude login and sees nothing from the project. The temp dir is removed afterwards.
   */
  export function createClaudeCliRunner(opts?: { command?: string; prefixArgs?: string[]; timeoutMs?: number }): ClaudeCliRunner;
  /** null when Claude Code is logged in with a claude.ai account; otherwise a message for the owner. */
  export function parseAuthStatus(stdout: string, exitCode: number | null): string | null;
  export async function checkClaudeLogin(run: ClaudeCliRunner): Promise<string | null>;
  ```
- Behavior:
  - `createClaudeCliRunner`:
    - Uses `child_process.spawn(command, [...prefixArgs, ...args], { cwd: fs.mkdtempSync(path.join(os.tmpdir(), "job-searcher-claude-")), env })`, where `env` is a copy of `process.env` without `ANTHROPIC_API_KEY`, and `stdio` is `["ignore", "pipe", "pipe"]`.
    - Collects stdout and stderr as UTF-8, and resolves on `close` with `{ stdout, stderr, exitCode }`.
    - `prefixArgs` exists for tests, which run `node <fixture>`.
    - Default `timeoutMs` is `300_000`. On a timeout, kill the child and reject with `new Error(\`claude timed out after ${timeoutMs / 1000}s\`)`.
    - On a spawn `error` with code `ENOENT`, reject with `new Error("Claude Code CLI not found. Install it and run \`claude auth login\`.")`. Any other spawn error rejects with that error.
    - Always remove the temp dir (`fs.rmSync(dir, { recursive: true, force: true })`).
  - `parseAuthStatus`:
    - Non-zero exit or non-JSON stdout → `"Claude Code is not logged in. Run \`claude auth login\`."`
    - `loggedIn !== true` → the same message.
    - `authMethod !== "claude.ai"` → `"Claude Code is not logged in with your Claude plan (it uses ${authMethod}). Run \`claude auth login\` with your claude.ai account."`
    - Otherwise `null`.
  - `checkClaudeLogin(run)`: `parseAuthStatus` of `run(["auth", "status"])`. If `run` rejects, return the error message.
- Fixture `fake-claude.mjs`, run as `node fake-claude.mjs <args>`:
  - Prints `JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), cwdEntries: fs.readdirSync(process.cwd()), hasApiKey: "ANTHROPIC_API_KEY" in process.env })` to stdout.
  - With the first arg `--exit=N`, it writes `"boom"` to stderr and exits with N.
  - With `--sleep=MS`, it waits MS before printing.
- Failure cases: as above (start failure, timeout, non-zero exit returned as data, login states).
- Tests first, with `const run = createClaudeCliRunner({ command: process.execPath, prefixArgs: [path.resolve("test/fixtures/claude-cli/fake-claude.mjs")] })`:
  - `passes the arguments and returns stdout`: `JSON.parse((await run(["-p", "hi"])).stdout).argv` equals `["-p", "hi"]`, and `exitCode` is `0`.
  - `runs in an empty temp dir`: `cwd` is not `process.cwd()`, it starts with `fs.realpathSync(os.tmpdir())` (compare realpaths), and `cwdEntries` equals `[]`.
  - `never passes ANTHROPIC_API_KEY`: with `process.env.ANTHROPIC_API_KEY = "test-key"` set in the test (restored after), `hasApiKey` is `false`.
  - `returns a non-zero exit as data`: `run(["--exit=3"])` resolves `{ exitCode: 3, stderr: "boom" }` (with `toMatchObject`).
  - `times out`: `createClaudeCliRunner({ command: process.execPath, prefixArgs: [fixture], timeoutMs: 200 })(["--sleep=5000"])` rejects with `"claude timed out after 0.2s"`.
  - `reports a missing CLI`: `createClaudeCliRunner({ command: "definitely-not-claude-xyz" })([])` rejects with `"Claude Code CLI not found. Install it and run \`claude auth login\`."`.
  - `parseAuthStatus` cases (pure):
    - `('{"loggedIn":true,"authMethod":"claude.ai"}', 0)` → `null`.
    - `('{"loggedIn":true,"authMethod":"apiKey"}', 0)` → the "not logged in with your Claude plan (it uses apiKey)…" message.
    - `('{"loggedIn":false}', 0)` and `("oops", 1)` → `"Claude Code is not logged in. Run \`claude auth login\`."`.
  - `checkClaudeLogin returns the start error`: with a runner that rejects `new Error("x")`, the result is `"x"`.
- Verify: `npm test -- src/ai/claude-cli.test.ts` passes.
- Commit: `feat(m4): run the Claude Code CLI isolated, and check its login (M4b T1)`
- [ ] Done

### T2: The `job_scores` table
- Depends on: T1
- Files: `src/db/schema.ts`, the generated `drizzle/0007_*.sql` and `drizzle/meta/*` (from `npm run db:generate`), `src/db/client.test.ts`
- Interfaces:
  ```ts
  /** One Claude score per scored job. A posting (jobs.group_id) is scored when any of its jobs has a row here. Never updated. */
  export const jobScores = sqliteTable("job_scores", {
    jobId: integer("job_id").primaryKey().references(() => jobs.id),
    score: integer("score").notNull(),
    reasons: text("reasons", { mode: "json" }).$type<string[]>().notNull(),
    model: text("model").notNull(),
    /** SHA-256 (hex) of the search description used, for reference. */
    searchHash: text("search_hash").notNull(),
    scoredAt: text("scored_at").notNull(),
  });
  ```
- Behavior: run `npm run db:generate`; the migration only creates `job_scores`. Don't edit it.
- Failure cases: none.
- Tests first, in `client.test.ts`: `creates job_scores`. Insert `baseJob`, then a `jobScores` row `{ jobId: job.id, score: 80, reasons: ["Good stack"], model: "m", searchHash: "h", scoredAt: "2026-11-24T00:00:00.000Z" }`. Reading it back gives `score` `80` and `reasons` `["Good stack"]`.
- Verify: `npm test -- src/db/client.test.ts` passes; a second `npx drizzle-kit generate` reports "No schema changes".
- Commit: `feat(m4): add the job_scores table (M4b T2)`
- [ ] Done

### T3: Save scores and find scored postings
- Depends on: T2
- Files: `src/db/scores.ts` (new), `src/db/scores.test.ts` (new)
- Interfaces:
  ```ts
  export type NewScore = { jobId: number; score: number; reasons: string[]; model: string; searchHash: string };
  /** Stores the scores in one transaction. A job that already has a score keeps it (never re-scored). */
  export function saveScores(db: Db, rows: NewScore[], nowIso: string): void;
  /** Group ids (jobs.group_id, or the job id when null) of every posting with at least one scored job. */
  export function listScoredGroupIds(db: Db): Set<number>;
  ```
  `saveScores` inserts with `.onConflictDoNothing()`. `listScoredGroupIds` selects `coalesce(jobs.group_id, jobs.id)` from `job_scores` joined to `jobs`.
- Failure cases:
  - Empty `rows`: does nothing.
  - No scores: an empty set.
  - A second save for the same job keeps the first score.
- Tests first, in-memory DB with `upsertJobs` (groups are assigned at insert, from M4a T3):
  - `saves scores and lists their groups`: insert two jobs with different titles, then `saveScores(db, [{ jobId: 2, score: 70, reasons: ["ok"], model: "m", searchHash: "h" }], NOW)`. `[...listScoredGroupIds(db)]` equals `[2]`.
  - `a posting is scored when another copy has a score`: greenhouse "Same Title", then a lever "Same Title" (same group 1). Save a score for job 2. `[...listScoredGroupIds(db)]` equals `[1]`.
  - `a job keeps its first score`: save score 70, then 10, for job 1. The stored `score` is `70`.
  - `no scores gives an empty set`: `listScoredGroupIds(db).size` is `0`.
- Verify: `npm test -- src/db/scores.test.ts` passes.
- Commit: `feat(m4): save scores and list scored postings (M4b T3)`
- [ ] Done

### T4: Rankable jobs carry their group, and variants are listed
- Depends on: T3
- Files: `src/db/ranking.ts`, `src/db/ranking.test.ts`
- Interfaces:
  - Add `groupId: number` to `RankableJob`, as its last field. `listOpenJobsForRanking` now keeps it: `groupId: row.groupId ?? row.id`.
  - Add:
    ```ts
    export type JobVariant = { jobId: number; title: string; location: string | null };
    /** Every open job of the given groups, by group id, in id order (the ranked job included). */
    export function listOpenVariants(db: Db, groupIds: number[]): Map<number, JobVariant[]>;
    ```
    It selects `id, title, location, coalesce(group_id, id)` of open jobs whose group is in `groupIds`, in chunks of 500 like `getEmbeddings`. An empty `groupIds` gives an empty map.
- Failure cases: a null `group_id` gives the job's own id.
- Tests first (a shape change, not a loosened assertion):
  - In `lists only open jobs, ordered by id, with the ranking fields`, add `groupId: 1` and `groupId: 2` to the two expected objects.
  - In `returns exactly the RankableJob fields`, add `"groupId"` to the sorted key list, between `"descriptionText"` and `"id"`.
  - `listOpenVariants lists the open jobs of each group`, inside `describe("duplicates")` (which has `insertThreeCities` and `setClosedAt`):
    - `insertThreeCities()` (three "Same Title" jobs in Bogota, Lima and LatAm, group 1) plus `makeJob("4")` (group 4), then `setClosedAt(3, NOW)`.
    - `listOpenVariants(db, [1, 4])` gives group 1 → `[{ jobId: 1, title: "Same Title", location: "Bogota" }, { jobId: 2, title: "Same Title", location: "Lima" }]` and group 4 → `[{ jobId: 4, title: "Engineer 4", location: "Remote" }]`.
    - `listOpenVariants(db, []).size` is `0`.
  - `a copy's groupId is its posting`, inside `describe("duplicates")`: greenhouse "Same Title", then a lever "Same Title", then `setClosedAt(1, NOW)`. `listOpenJobsForRanking(db)[0]` matches `{ id: 2, groupId: 1 }`.
- Verify: `npm test -- src/db/ranking.test.ts src/ranking/embed-jobs.test.ts src/scripts/rank-cli.test.ts` passes; `npm run typecheck` passes.
- Commit: `feat(m4): rankable jobs carry their posting group, and variants are listed (M4b T4)`
- [ ] Done

### T5: The scoring prompt and the answer check
- Depends on: T4
- Files: `src/ai/score-prompt.ts` (new), `src/ai/score-prompt.test.ts` (new)
- Interfaces:
  ```ts
  export const SCORE_MAX_CHARS = 4000;
  export const SCORING_INSTRUCTIONS: string; // exact text below
  export const ScoreOutputSchema = z.object({
    scores: z.array(z.object({ job_id: z.number().int(), score: z.number().int().min(0).max(100), reasons: z.array(z.string()).min(1).max(3) })),
  });
  /** The same shape as JSON Schema, for `claude --json-schema` (ranges are checked by ScoreOutputSchema afterwards). */
  export const SCORE_JSON_SCHEMA = {
    type: "object",
    properties: {
      scores: {
        type: "array",
        items: {
          type: "object",
          properties: { job_id: { type: "integer" }, score: { type: "integer" }, reasons: { type: "array", items: { type: "string" } } },
          required: ["job_id", "score", "reasons"],
          additionalProperties: false,
        },
      },
    },
    required: ["scores"],
    additionalProperties: false,
  } as const;
  export type ScoreOutput = z.infer<typeof ScoreOutputSchema>;
  export type JobScore = { jobId: number; score: number; reasons: string[] };
  /** A ranked job plus the other open jobs of its posting group (location variants), without itself. */
  export type ScoringJob = RankableJob & { variants: { title: string; location: string | null }[] };
  export function buildJobsMessage(jobs: ScoringJob[]): string;
  export function buildSearchBlock(search: string): string; // `Search description:\n\n${search.trim()}`
  /** Matches the answer to the jobs sent: every sent id with a valid entry is scored; the rest are missing. */
  export function checkScores(output: ScoreOutput, jobIds: number[]): { scores: JobScore[]; missingJobIds: number[] };
  ```
  `SCORING_INSTRUCTIONS`, exactly:
  ```
  You score job postings for one job seeker. The search description below says what they want, where they live and the constraints they work under.

  For every job in the user message, return:
  - job_id: the number in the job's <job id="..."> tag
  - score: an integer from 0 to 100 for how well the job fits the search
  - reasons: 1 to 3 short reasons, at most 20 words each, the most important first

  How to score:
  - 90-100: a strong match on role, seniority, stack and working conditions, with nothing ruling it out
  - 70-89: a good match with minor gaps
  - 40-69: a partial match: the role or stack is related, but important parts differ
  - 0-39: a poor match, or the job is ruled out

  Eligibility comes first. If the posting requires living in, being a citizen of, or being authorized to work in a country or region the search description doesn't cover, or requires onsite or hybrid work somewhere the job seeker can't go, score it 20 or lower and give that as the first reason. If eligibility is unclear, don't lower the score for it, but mention it in a reason.

  Some jobs list other versions of the same opening under "Also listed as", usually for other countries or cities. The job is eligible if any version is: judge it by the best-fitting version and name that version in a reason.

  Judge only from the posting text and don't invent details. Write the reasons in English. Return every job_id exactly once.
  ```
- Behavior:
  - `buildJobsMessage` joins one block per job with a blank line between blocks:
    ```
    <job id="{id}">
    Title: {title}
    Company: {company}
    Location: {location ?? "unknown"}
    Departments: {departments joined with ", "}      ← only when departments is non-empty
    Salary: {salaryMin ?? "?"}–{salaryMax ?? "?"} {salaryCurrency ?? ""} per {salaryPeriod ?? "?"}   ← only when salaryMin or salaryMax is set; trim the line
    Also listed as:                                   ← only when variants is non-empty
    - {variant.title} ({variant.location ?? "location unknown"})   ← one line per variant, in the given order

    {descriptionText.trim(), cut to SCORE_MAX_CHARS characters}
    </job>
    ```
  - `checkScores`: keep the first entry per `job_id` that is in `jobIds`, and ignore unknown or duplicate ids. `scores` follows the order of `jobIds`. `missingJobIds` lists the sent ids with no entry, in `jobIds` order.
- Failure cases:
  - An empty description gives an empty body line between the header and `</job>`.
  - Unknown ids in the answer are ignored.
- Tests first:
  - `builds one block per job`: one job `{ id: 7, title: "Senior React Developer", company: "Acme", location: null, departments: ["Engineering"], tags: [], salaryMin: 80000, salaryMax: 100000, salaryCurrency: "USD", salaryPeriod: "year", descriptionText: "  Build things.  ", url: "u", groupId: 7, variants: [] }` gives exactly `'<job id="7">\nTitle: Senior React Developer\nCompany: Acme\nLocation: unknown\nDepartments: Engineering\nSalary: 80000–100000 USD per year\n\nBuild things.\n</job>'`.
  - `omits empty departments and salary`: the same job with `departments: []` and every salary field null gives `'<job id="7">\nTitle: Senior React Developer\nCompany: Acme\nLocation: unknown\n\nBuild things.\n</job>'`.
  - `lists the variants`: the same job with `departments: []`, every salary field null and `variants: [{ title: "Senior React Developer (BR based only)", location: "São Paulo" }, { title: "Senior React Developer - LATAM", location: null }]` gives exactly `'<job id="7">\nTitle: Senior React Developer\nCompany: Acme\nLocation: unknown\nAlso listed as:\n- Senior React Developer (BR based only) (São Paulo)\n- Senior React Developer - LATAM (location unknown)\n\nBuild things.\n</job>'`.
  - `the instructions explain variants`: `SCORING_INSTRUCTIONS` contains `"Also listed as"`.
  - `trims long descriptions`: a description of 5,000 `"a"`s produces a block containing exactly 4,000 `"a"`s.
  - `separates jobs with a blank line`: two jobs give two blocks joined by `"\n\n"`.
  - `buildSearchBlock`: `buildSearchBlock(" React dev \n")` equals `"Search description:\n\nReact dev"`.
  - `checkScores keeps sent ids in order and reports missing ones`: output `{ scores: [{ job_id: 3, score: 40, reasons: ["c"] }, { job_id: 1, score: 90, reasons: ["a"] }, { job_id: 1, score: 10, reasons: ["dup"] }, { job_id: 99, score: 50, reasons: ["x"] }] }` with `jobIds` `[1, 2, 3]` gives `{ scores: [{ jobId: 1, score: 90, reasons: ["a"] }, { jobId: 3, score: 40, reasons: ["c"] }], missingJobIds: [2] }`.
  - `ScoreOutputSchema rejects a score above 100`: `safeParse({ scores: [{ job_id: 1, score: 101, reasons: ["x"] }] }).success` is `false`.
- Verify: `npm test -- src/ai/score-prompt.test.ts` passes.
- Commit: `feat(m4): the scoring prompt and answer check (M4b T5)`
- [ ] Done

### T6: The `Scorer` interface and job selection
- Depends on: T5
- Files: `src/ai/scorer.ts` (new), `src/ai/select.ts` (new), `src/ai/select.test.ts` (new)
- Interfaces:
  ```ts
  // scorer.ts
  export type ScoreUsage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
  export type ScoreBatchResult = { scores: JobScore[]; failedJobIds: number[]; problem: string | null; usage: ScoreUsage };
  /** Scores a batch of jobs against the search. The real one runs Claude Code; tests use a fake. */
  export interface Scorer {
    readonly model: string;
    score(search: string, jobs: ScoringJob[]): Promise<ScoreBatchResult>;
  }
  // select.ts
  export type ScoreMode = "top" | "next";
  /** The postings to score: unscored ones among the first `count` ranked ("top"), or the first `count` unscored ones ("next"). */
  export function selectForScoring<J extends { groupId: number }>(ranked: J[], scoredGroups: Set<number>, mode: ScoreMode, count: number): J[];
  ```
- Behavior: `top` → `ranked.slice(0, count).filter(unscored)`; `next` → `ranked.filter(unscored).slice(0, count)`.
- Failure cases: an empty ranking or a count beyond the length is fine; everything already scored gives `[]`.
- Tests first, in `select.test.ts`, with `const r = [1, 2, 3, 4, 5].map((g) => ({ groupId: g }))` and `scored = new Set([1, 3])`:
  - `top scores the unscored among the first count`: `selectForScoring(r, scored, "top", 3).map((j) => j.groupId)` equals `[2]`.
  - `next takes the first count unscored`: `selectForScoring(r, scored, "next", 2)` gives groups `[2, 4]`.
  - `count beyond the ranking`: `selectForScoring(r, new Set(), "top", 10)` has length `5`.
  - `everything scored`: `selectForScoring(r, new Set([1, 2, 3, 4, 5]), "next", 3)` equals `[]`.
- Verify: `npm test -- src/ai/select.test.ts` passes; `npm run typecheck` passes.
- Commit: `feat(m4): the Scorer interface and job selection (M4b T6)`
- [ ] Done

### T7: The Claude Code scorer
- Depends on: T6
- Files: `src/ai/claude-cli-scorer.ts` (new), `src/ai/claude-cli-scorer.test.ts` (new), `test/fixtures/claude-cli/score-two-jobs.json` (new)
- Interfaces:
  ```ts
  export const DEFAULT_SCORING_MODEL = "claude-haiku-5-5";
  export const SCORE_BATCH_SIZE = 10;
  export function buildClaudeArgs(model: string, search: string, jobs: ScoringJob[]): string[];
  export function createCliScorer(opts: { run: ClaudeCliRunner; model?: string }): Scorer;
  ```
- Behavior:
  - `buildClaudeArgs` returns exactly:
    ```ts
    ["-p", "--model", model, "--output-format", "json", "--json-schema", JSON.stringify(SCORE_JSON_SCHEMA),
     "--system-prompt", `${SCORING_INSTRUCTIONS}\n\n${buildSearchBlock(search)}`,
     "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--no-session-persistence",
     buildJobsMessage(jobs)]
    ```
  - `score(search, jobs)`:
    ```
    { stdout, stderr, exitCode } = await run(buildClaudeArgs(model, search, jobs))   // a rejection propagates
    json = try JSON.parse(stdout) catch → undefined
    if json is undefined:
      throw exitCode === 0 ? Error(`claude returned non-JSON output: ${first 200 chars of stdout}`)
                           : Error(`claude exited with code ${exitCode}: ${first 300 chars of (stderr.trim() || stdout.trim())}`)
    r = CliResultSchema.parse(json)     // z.looseObject({ type, subtype: string, is_error: boolean, result: string|null|undefined,
                                        //   structured_output: unknown, stop_reason: string|null|undefined,
                                        //   usage: z.looseObject({ input_tokens, output_tokens, cache_read_input_tokens?, cache_creation_input_tokens? }).optional() })
    if r.is_error or exitCode !== 0: throw Error(`claude reported an error (${r.subtype}): ${r.result ?? ""}`.trim())
    usage = { inputTokens: r.usage?.input_tokens ?? 0, outputTokens: r.usage?.output_tokens ?? 0,
              cacheReadTokens: r.usage?.cache_read_input_tokens ?? 0, cacheWriteTokens: r.usage?.cache_creation_input_tokens ?? 0 }
    ids = jobs.map(j => j.id)
    if r.stop_reason === "refusal": return { scores: [], failedJobIds: ids, problem: "refused", usage }
    out = ScoreOutputSchema.safeParse(r.structured_output)
    if !out.success: return { scores: [], failedJobIds: ids, problem: "unparseable answer", usage }
    { scores, missingJobIds } = checkScores(out.data, ids)
    return { scores, failedJobIds: missingJobIds, problem: missingJobIds.length ? `${missingJobIds.length} jobs missing from the answer` : null, usage }
    ```
  - `.model` is the requested model (default `DEFAULT_SCORING_MODEL`).
- Fixture `score-two-jobs.json`: a `claude -p --output-format json` result, in the shape recorded on 2026-11-24 and confirmed by T10:
  ```json
  { "type": "result", "subtype": "success", "is_error": false, "num_turns": 2, "stop_reason": "end_turn",
    "result": "{\"scores\":[{\"job_id\":1,\"score\":85,\"reasons\":[\"Remote senior React role\"]},{\"job_id\":2,\"score\":15,\"reasons\":[\"Onsite in Paris\"]}]}",
    "structured_output": { "scores": [ { "job_id": 1, "score": 85, "reasons": ["Remote senior React role"] }, { "job_id": 2, "score": 15, "reasons": ["Onsite in Paris"] } ] },
    "usage": { "input_tokens": 12, "output_tokens": 300, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 1500 },
    "modelUsage": { "claude-haiku-5-5": {} }, "total_cost_usd": 0.0009 }
  ```
- Tests first: `run = vi.fn(async () => ({ stdout: JSON.stringify(fixture), stderr: "", exitCode: 0 }))` unless a test overrides it. Use two `ScoringJob`s, ids 1 and 2, with `variants: []`, and search `"React dev"`.
  - `buildClaudeArgs is isolated and never bare`:
    - The args contain `"-p"`, `"--strict-mcp-config"` and `"--no-session-persistence"`.
    - The value after each of these flags: `"--model"` → `"claude-haiku-5-5"`; `"--output-format"` → `"json"`; `"--tools"` → `""`; `"--setting-sources"` → `""`.
    - The value after `"--system-prompt"` equals `` `${SCORING_INSTRUCTIONS}\n\nSearch description:\n\nReact dev` ``.
    - `JSON.parse` of the value after `"--json-schema"` equals `SCORE_JSON_SCHEMA`.
    - The last arg equals `buildJobsMessage(jobs)`, and the args don't contain `"--bare"`.
  - `returns the scores and the usage`: the result equals `{ scores: [{ jobId: 1, score: 85, reasons: ["Remote senior React role"] }, { jobId: 2, score: 15, reasons: ["Onsite in Paris"] }], failedJobIds: [], problem: null, usage: { inputTokens: 12, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 1500 } }`, and `run` was called once.
  - `uses another model when given`: `createCliScorer({ run, model: "claude-sonnet-5-5" })` passes `--model claude-sonnet-5-5` and has `.model === "claude-sonnet-5-5"`.
  - `a refusal leaves the batch unscored`: `{ ...fixture, stop_reason: "refusal", structured_output: null }` gives `{ scores: [], failedJobIds: [1, 2], problem: "refused" }` (with `toMatchObject`).
  - `an answer outside the schema leaves the batch unscored`: `structured_output: { scores: [{ job_id: 1, score: 150, reasons: ["x"] }] }` gives `problem: "unparseable answer"`.
  - `a missing job is reported`: `structured_output` with only job 1 gives `failedJobIds: [2], problem: "1 jobs missing from the answer"`.
  - `an error result stops the run`: `{ ...fixture, is_error: true, subtype: "error_during_execution", result: "Claude usage limit reached" }` rejects with `"claude reported an error (error_during_execution): Claude usage limit reached"`.
  - `a failed process stops the run`: `{ stdout: "", stderr: "not logged in\n", exitCode: 1 }` rejects with `"claude exited with code 1: not logged in"`.
  - `non-JSON output stops the run`: `{ stdout: "hello", stderr: "", exitCode: 0 }` rejects with `"claude returned non-JSON output: hello"`.
  - `runner errors propagate`: `run` rejecting with `new Error("claude timed out after 300s")` makes `score` reject with that message.
- Verify: `npm test -- src/ai/claude-cli-scorer.test.ts` passes; `npm run typecheck` passes.
- Commit: `feat(m4): score jobs with Claude through Claude Code (M4b T7)`
- [ ] Done

### T8: The score command
- Depends on: T7
- Files: `src/scripts/score-cli.ts` (new), `src/scripts/score-cli.test.ts` (new), `src/test-utils/fake-scorer.ts` (new)
- Interfaces:
  ```ts
  export function parseScoreArgs(argv: string[]): { mode: ScoreMode; count: number; model: string; dryRun: boolean };
  export interface ScoreCliDeps {
    openDb: () => Db;
    createEmbedder: () => Promise<Embedder>;
    createScorer: (model: string) => Scorer;
    /** null when Claude Code is logged in with the owner's Claude plan, else a message (see checkClaudeLogin). */
    checkClaude: () => Promise<string | null>;
    configDir?: string;            // default "config"
    batchSize?: number;            // default SCORE_BATCH_SIZE
    now?: () => Date;
    out: { log(msg: string): void; error(msg: string): void; table(rows: Array<Record<string, string | number>>): void };
  }
  export async function runScoreCli(argv: string[], deps: ScoreCliDeps): Promise<number>;
  // fake-scorer.ts
  export function createFakeScorer(opts?: { model?: string; fail?: (callIndex: number) => boolean; omit?: (jobId: number) => boolean }): Scorer & { calls: ScoringJob[][] };
  ```
  - `parseScoreArgs`:
    - `--next` → mode `"next"` (default `"top"`).
    - `--count N` → an integer ≥ 1, else `CliUsageError("Missing or invalid value for --count")` (default 100).
    - `--model <id>` → a non-empty value not starting with `--`, else `CliUsageError("Missing value for --model")` (default `DEFAULT_SCORING_MODEL`).
    - `--dry-run` → true.
    - Anything else → `CliUsageError(\`Unknown option: ${arg}\`)`.
  - Fake scorer:
    - `score` = `min(100, 50 + 10 × occurrences of "react" (case-insensitive) in title + description)`.
    - `reasons: ["fake reason"]`; `model` defaults to `"fake-scorer"`.
    - Usage per call: `{ inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 50 }`.
    - `fail(callIndex)` throws `new Error("scorer crashed")`.
    - `omit(jobId)` leaves that job out, with `failedJobIds` and `problem: "N jobs missing from the answer"` (as `checkScores` words it).
- Behavior of `runScoreCli`, in order:
  1. Parse the args. A `CliUsageError` → `out.error(message)`, return 1.
  2. Load the search and the rules exactly as `rank-cli` does, with the same messages and the same `fromExample` log.
  3. `login = await deps.checkClaude()`. If not a dry run and `login !== null`: `out.error(login)`, return 1, without opening the DB.
  4. Open the DB, then `ensureJobGroups` (log `Assigned posting groups to N jobs` when N > 0).
  5. `jobs = listOpenJobsForRanking(db, (job) => checkJobRules(job, rules).pass)`. If there are none, log `No open jobs to score. Run npm run fetch first.` and return 0.
  6. Create the embedder, embed the search, run `embedJobs` (log `Embedded X new or changed jobs, reused Y`), then `rankJobs(jobs, vectors, searchVector, jobs.length)`. Use the same error messages and exit codes as rank.
  7. `scored = listScoredGroupIds(db)`; `toScore = selectForScoring(ranked.map((r) => r.job), scored, mode, count)`.
  8. Log `Open postings: ${jobs.length}, already scored: ${jobs.filter((j) => scored.has(j.groupId)).length}, to score: ${toScore.length}`.
  9. If `toScore` is empty, log `Nothing new to score.` and return 0.
  10. Dry run: log `Dry run: would score ${toScore.length} jobs in ${ceil(n / batchSize)} requests with ${model}` and `Claude Code login: ${login ?? "ok (your Claude plan)"}`, then return 0. The scorer isn't created.
  11. `scorer = createScorer(model)`; `searchHash = sha256(search.trim())` (hex).
      - Attach the variants: `variants = listOpenVariants(db, toScore.map((j) => j.groupId))`, and each job becomes `{ ...job, variants: (variants.get(job.groupId) ?? []).filter((v) => v.jobId !== job.id).map(({ title, location }) => ({ title, location })) }`.
      - For each batch of `batchSize`, in rank order:
        - `result = await scorer.score(search, batch)`. On a throw: `out.error(\`Scoring failed: ${errorText(err)}\`)`, return 1.
        - `saveScores(db, result.scores.map(...), nowIso)` with `model: scorer.model`.
        - If `result.problem`: log `Batch ${k} (${batch.length} jobs): ${result.problem}`, with `k` from 1.
        - Add up the usage and remember the scores.
  12. `out.table` of this run's scores, sorted by score descending then rank: `{ score, title, company, location: location ?? "", url, reasons: reasons.join("; ") }`.
  13. Log `Scored ${scoredCount} jobs, ${failedCount} left unscored`.
  14. Log `Tokens: input ${i}, cache read ${cr}, cache write ${cw}, output ${o} (on your Claude plan)`.
  15. Return 0.
- Failure cases:
  - Bad args or config: return 1 before the DB is opened.
  - Not logged in with the Claude plan (not a dry run): return 1 before the DB.
  - No open jobs, or nothing new: return 0 without creating the scorer.
  - The scorer throws (a usage limit, a timeout, a failed `claude`): return 1, keeping earlier batches.
  - Missing jobs: logged and left unscored; they're picked up on a later run.
- Tests first, in `score-cli.test.ts`, mirroring `rank-cli.test.ts`:
  - Setup:
    - A temp dir with `search.md` `"React and Node developer\n"` and `job-filter-rules.json` `{ "keywords": ["developer", "engineer"] }`, and an in-memory DB.
    - Four open greenhouse Acme jobs (with an Acme `companyId`): `acme:a` "Senior React Developer" ("React and Node"), `acme:b` "Senior Python Developer" ("Python"), `acme:c` "Senior Node Engineer" ("Node"), `acme:d` "Mobile Developer" ("React").
    - `createFakeEmbedder()`, `createFakeScorer()`, `checkClaude: async () => null`, and `NOW = 2026-11-24T12:00:00.000Z`.
  - The ranking order is React, Mobile, Node, Python.
  - `scores the top jobs and stores them`:
    - `run(["--count", "2"])` returns 0, and the scorer was called once with the job titles `["Senior React Developer", "Mobile Developer"]`.
    - `job_scores` has 2 rows with `model` `"fake-scorer"`, and `searchHash` equals `createHash("sha256").update("React and Node developer").digest("hex")`.
    - `logs` contains `"Open postings: 4, already scored: 0, to score: 2"`, `"Scored 2 jobs, 0 left unscored"` and `"Tokens: input 100, cache read 0, cache write 50, output 20 (on your Claude plan)"`.
    - The table's first row matches `{ score: 70, title: "Senior React Developer", reasons: "fake reason" }`.
  - `a second run scores nothing new`: `run(["--count", "2"])` twice. The second run logs `"Nothing new to score."` and the scorer has 1 call in total.
  - `--next continues down the ranking`: `run(["--count", "2"])`, then `run(["--next", "--count", "2"])`. The second scorer call has titles `["Senior Node Engineer", "Senior Python Developer"]`.
  - `a posting scored through another copy is skipped`:
    - Score with `--count 1` (React).
    - Add a Lever copy of "Senior React Developer" (description "React and Node", no `companyId`, so it joins by title from another site), and close `acme:a`.
    - `run(["--next", "--count", "1"])` scores `["Mobile Developer"]`.
  - `jobs failing the rules are not scored`: rules `{ "keywords": ["react"] }`; `run([])` scores only `["Senior React Developer"]`. Keywords read titles, departments and tags, never descriptions, so "Mobile Developer" fails.
  - `batches of the given size`: `batchSize: 3`; `run([])` makes 2 scorer calls, with 3 and 1 jobs.
  - `a missing job is logged and left unscored`:
    - `omit: (id) => id === 4`; `run([])` returns 0.
    - `logs` contains `"Batch 1 (4 jobs): 1 jobs missing from the answer"` and `"Scored 3 jobs, 1 left unscored"`.
    - `job_scores` has 3 rows.
  - `a scorer error stops the run and keeps earlier batches`: `batchSize: 2`, `fail: (i) => i === 1`. `run([])` returns 1, `errors` equals `["Scoring failed: Error: scorer crashed"]`, and `job_scores` has 2 rows.
  - `--dry-run calls no scorer`:
    - `run(["--dry-run"])` returns 0.
    - `logs` contains `"Dry run: would score 4 jobs in 1 requests with claude-haiku-5-5"` and `"Claude Code login: ok (your Claude plan)"`.
    - `createScorer` wasn't called, and `job_scores` has 0 rows.
  - `--dry-run reports a login problem without failing`: `checkClaude: async () => "Claude Code is not logged in. Run \`claude auth login\`."`; it returns 0 and logs `"Claude Code login: Claude Code is not logged in. Run \`claude auth login\`."`.
  - `not logged in fails before opening the DB`: the same `checkClaude`; `run([])` returns 1, `errors` equals `["Claude Code is not logged in. Run \`claude auth login\`."]`, and `openDb` wasn't called.
  - `the scorer gets the other variants of a posting`:
    - Insert, with the Acme `companyId`, `job("acme:latam", "Senior React Developer - LATAM", "React and Node")` with `location: "LatAm"`. Same company and description as `acme:a`, so the same group.
    - `run(["--count", "1"])` sends one job, `acme:a`, whose `variants` equal `[{ title: "Senior React Developer - LATAM", location: "LatAm" }]`.
  - `--model is passed to createScorer`: `run(["--model", "claude-sonnet-5-5", "--count", "1"])` calls `createScorer` with `"claude-sonnet-5-5"`.
  - `no open jobs returns 0 without loading the model`: an empty DB → `logs` equals `["No open jobs to score. Run npm run fetch first."]`, and `createEmbedder` wasn't called.
  - `rejects bad arguments`, via `it.each`:
    - `[["--count"], "Missing or invalid value for --count"]`
    - `[["--count", "0"], "Missing or invalid value for --count"]`
    - `[["--model"], "Missing value for --model"]`
    - `[["--model", "--next"], "Missing value for --model"]`
    - `[["--bogus"], "Unknown option: --bogus"]`

    Each returns 1 with that exact error.
- Verify: `npm test -- src/scripts/score-cli.test.ts` passes; `npm run lint && npm run typecheck` pass.
- Commit: `feat(m4): npm run score logic: select, score in batches, store (M4b T8)`
- [ ] Done

### T9: Wire up `npm run score`
- Depends on: T8
- Files: `src/scripts/score.ts` (new), `package.json`
- Behavior:
  - `score.ts` mirrors `rank.ts`. Create `const run = createClaudeCliRunner();`, then call `runScoreCli(process.argv.slice(2), { … })` with these deps:
    - `openDb: () => openDb({ migrate: true })`
    - `createEmbedder: () => createTransformersEmbedder()`
    - `createScorer: (model) => createCliScorer({ run, model })`
    - `checkClaude: () => checkClaudeLogin(run)`
    - `out` = `console.log` / `console.error` / `console.table`
  - The process exits with the returned code; an unexpected rejection logs and exits 1.
  - Add the script `"score": "tsx src/scripts/score.ts"` (no env file: there's no key).
- Failure cases: none beyond T8.
- Tests first: none (process wiring; the logic is tested in T1 and T8).
- Verify: `npm run score -- --dry-run` runs against the real DB, logs `Open postings: …`, the `Dry run: …` line and `Claude Code login: ok (your Claude plan)`, and runs no scoring call. If the login line shows a problem, report it to the owner; don't log in on their behalf.
- Commit: `feat(m4): add npm run score (M4b T9)`
- [ ] Done

### T10: Live check
- Depends on: T9
- Files: `src/ai/claude-cli-scorer.live.test.ts` (new)
- Behavior: one test, `it("scores a clear match above a clear mismatch", async (ctx) => { … }, 300_000)`:
  - First `const problem = await checkClaudeLogin(createClaudeCliRunner())`; if `problem` is not null, call `ctx.skip()`. CI has no Claude login, so the nightly live run skips it.
  - Use `createCliScorer({ run: createClaudeCliRunner() })` with the synthetic search `"Remote senior React developer living in Argentina."`. Never the real `config/search.md`.
  - Score two `ScoringJob`s:
    - id 1: "Senior React Developer", company "Acme", location "Remote - LATAM", description `"Fully remote. We hire in Latin America. React, TypeScript, Node."`;
    - id 2: "Line Cook", company "Bistro", location "Paris, France", description `"Onsite kitchen role in Paris. EU work permit required."`.
    - Every other field is empty or null; `groupId` equals the id; `variants: []`.
  - Expect `failedJobIds` `[]`, both ids scored, and the score of 1 > the score of 2.
- Failure cases: not logged in → skipped.
- Tests first: this file is the test.
- Verify:
  - `npm test` doesn't run it: the default config excludes `*.live.test.ts`.
  - Run `npm run test:live -- src/ai/claude-cli-scorer.live.test.ts` once. It uses a tiny amount of the owner's Claude plan and no money.
  - Report the two scores, and compare the real result's top-level keys with the fixture `score-two-jobs.json`. If they differ, update the fixture to match, and say so.
- Commit: `test(m4): live check for scoring through Claude Code (M4b T10)`
- [ ] Done

### T11: Docs
- Depends on: T1–T10
- Files: `CLAUDE.md`, `PLAN.md`
- Behavior:
  - `CLAUDE.md`:
    - Commands: replace the `- Planned:` item and its sub-bullet with `- Score jobs: \`npm run score [-- --count N | --next | --model <id> | --dry-run]\` (Claude scores the top-ranked postings with no score yet, once each, through Claude Code on the owner's Claude plan; default model claude-haiku-5-5)`.
    - Configuration and secrets: replace the `ANTHROPIC_API_KEY` bullet with `- Scoring (M4) runs Claude through the Claude Code CLI (\`claude -p\`) on the owner's Claude plan. Log in once with \`claude auth login\` (claude.ai account). No API key is used.`
    - Architecture: in the stack sentence, replace `Anthropic SDK (M4)` with `the Claude Code CLI for scoring (M4)`.
    - Rules: replace `The Anthropic API (Claude) is the only paid service.` with `Claude, through the owner's Claude plan (Claude Code), is the only paid service.`, and in the rate-limits rule replace `go only to the Anthropic API, for scoring` with `go only to Claude, for scoring`.
  - `PLAN.md`:
    - Change the heading `### M4: Claude scoring (current)` to `### M4: Claude scoring (done)`, and the M5 heading to `(current)` if it has a status.
    - In the M4 section, replace the bullet that starts with `- API key:` with `- Claude runs through Claude Code (\`claude -p\`) on the owner's Claude plan: no API key, and the plan's usage limits are the cap.`
    - In "Stack & key decisions", change the Anthropic API bullet to `- Claude (through Claude Code, on my Claude plan): the only paid service. Scores only the top-ranked jobs, each job once.`
    - Append to the decisions log: `- <today's date>: M4b: npm run score scores the unscored postings among the top N ranked (default 100) through Claude Code (claude -p) on the owner's Claude plan, not the API: no key, no per-token billing, the plan's usage limits cap it. Each call is isolated (empty temp dir, no tools, no MCP, no settings, no API key in its environment, never --bare). Default model Claude Haiku 5.5 (--model to change), 10 jobs per call, structured JSON output (0-100 + 1-3 reasons); each job lists its posting's other location variants and counts as eligible if any variant is; --next scores the next N unscored; a posting is scored once ever (job_scores per job, checked per posting group), with the model, a SHA-256 of the search text and the date; refusals and bad or missing answers leave jobs unscored for a later run; a failed or limited claude call stops the run, keeping saved batches.`
- Failure cases: none (docs only).
- Verify: `grep -n "npm run score\|claude auth login" CLAUDE.md` shows the new lines; `grep -n "ANTHROPIC_API_KEY\|Planned:" CLAUDE.md` prints nothing.
- Commit: `docs(m4): document npm run score on the Claude plan (M4b T11)`
- [ ] Done

## Milestone verification
1. `nvm use && npm run lint && npm run typecheck && npm test && npm run test:coverage` pass, including the thresholds.
2. `npx drizzle-kit generate` reports "No schema changes".
3. `npm run score -- --dry-run` against the real DB logs `Open postings: N, already scored: 0, to score: M`, the dry-run line and `Claude Code login: ok (your Claude plan)`. Report them.
4. **Ask the owner before the first real scoring run** (it uses their plan's usage). With approval, run `npm run score -- --count 20`: 20 jobs in 2 calls. Report:
   - the `Scored …` and `Tokens …` lines;
   - whether `cache read` is above 0;
   - the top 5 rows of the table, including whether Double's "(ARG/UY based only)" / "(BR based only)" posting, if present, was judged by the eligible variant.

   Then run `npm run score -- --count 20` again; it logs `Nothing new to score.`
5. `git log --oneline <M4a's last commit>..` shows 11 task commits. `git status --short` is clean.

## Gotchas
- **Never use `--bare`.** It ignores the claude.ai login and needs an API key, which would mean API billing or a failure.
- **Strip `ANTHROPIC_API_KEY` from the child's environment.** If it were set, Claude Code would use the key instead of the plan.
- **Run `claude` in an empty temp dir,** never the repo: the repo's `CLAUDE.md` would be loaded into the prompt (wasted tokens and project context).
- **`--tools ""` and `--strict-mcp-config` are required.** Without them, the scorer could reach the owner's connected services (Gmail, Drive, ...).
- **Arguments are passed as an array to `spawn`,** with no shell, so job text with quotes or `$` is safe. Never build a shell command string.
- **`structured_output` can be missing or off-schema** even when `is_error` is false; validate it with `ScoreOutputSchema`.
- **Keep the system prompt byte-stable** within a run (instructions + search only, no dates or ids), so later batches can hit the cache.
- **Save after each batch,** inside the loop, before the next call.
- **Selection uses posting groups**, not job ids: a scored copy makes the whole posting scored.
- **Unit tests must never run the real `claude`.** Only `score.ts`, the T9 dry run and the T10 live check do.

## Open questions / assumptions
None. The owner chose to score on their Claude Pro plan through Claude Code (no API) with Haiku 5.5 as the default model. The CLI behaviour was checked with Claude Code 2.1.322 on 2026-11-24.
