# M4a: Stored posting groups (before Claude scoring)

Base: commit `943f5d7` on branch `main`. Executed with the `execute-plan` skill. This is part 1 of M4. Part 2 is [m4b-claude-scoring.md](m4b-claude-scoring.md).

## Goal
Every stored job carries a `group_id`: the posting it belongs to, decided once when the job is stored. Ranking (and, in M4b, scoring) reads that stored group instead of regrouping in memory. This fixes three problems with the M3.6 in-memory grouping:
- a copy from another job site could hide a different opening with the same title;
- grouping depended on row order and on which copies passed the rules;
- unrelated same-name companies were grouped with no time limit.

It also groups **location variants**: one company board posting the same opening with different titles, such as Truelogic's "…Real Estate - Brazil/Remote" and "…Real Estate - Colombia/Remote", or Double's "(ARG/UY based only)" and "(BR based only)". M4b shows Claude every variant, so an eligible variant can't be hidden behind an ineligible one.

It also includes the small cleanups left from the M3.6 review.

## Context
- Branch: `git switch main && git pull`, then `git switch -c feat/m4a-posting-groups`. Bring this spec and its `PLAN.md` link (uncommitted) along. Run `nvm use` first (Node 26, from `.nvmrc`).
- Commits:
  - One per task, with the exact message given, ending with the session's attribution line.
  - Tick the task's `- [ ] Done` in this file in the same commit.
  - Commit this spec, `m4b-claude-scoring.md` and the `PLAN.md` links first, as `docs(m4): add the M4a and M4b specs and link them from PLAN.md`.
- Rules from `CLAUDE.md`:
  - TDD.
  - All DB access goes through `src/db/`.
  - Never edit `drizzle/` by hand. A new migration is generated with `npm run db:generate`.
  - Run lint, typecheck and the full test suite before every commit.
  - Never commit `config/search.md` or `config/job-filter-rules.json`.
- Testing:
  - Vitest, no `vi.mock`, exact literal values.
  - DB tests use `openDb({ url: ":memory:", migrate: true })`.
  - Never read or write the real `config/` from tests.
- Decisions already made:
  - **A group id is the lowest job id in its group.** A new job with no match gets its own id. Group ids are plain integers with an index, no foreign key: the code keeps them valid, and SQLite can't add a self-reference cleanly to an existing table.
  - **When jobs are the same posting.** A new job N is compared with already-grouped jobs J whose `lastSeenAt >= N.firstSeenAt - 30 days`. That's the same 30-day window as `findOriginal`, and it stops unrelated same-name companies from being grouped months apart.
    - **Strong match**, any of:
      - the same non-null `applyUrl`;
      - the same `source`, the same `dedupeKey` and the same non-empty `descriptionText`;
      - the same non-null `companyId` (the same company board) and the same non-empty `descriptionText`, **whatever the title**. These are location variants of one opening (the owner's decision), and M4b lists all the variants for Claude.

      Strong matches are safe to merge: if N strongly matches several groups, they all merge into the lowest group id.
    - **Weak match:** the same `dedupeKey` from a different `source` (title and company across job sites, where formatting differs). A weak candidate group is ignored when it already has a member from N's source: on N's own board, that group's job is a different opening, or it would have been a strong match. If several weak groups remain, N joins the lowest and nothing merges.
    - Strong matches win over weak ones.
  - **Groups are decided at insert only.** An update of an existing job (same `source` + `externalId`) keeps its group.
  - **Existing rows** get groups from `ensureJobGroups(db)`, which applies the same rules in id order. `npm run rank` calls it before listing, so the live DB is backfilled on the next rank run. After the Node 26 rebuild on 2026-11-24, the live DB has 159 jobs, all open. With these rules they form 145 postings (151 without the location-variant rule); simulated, not yet run.
  - **`duplicateOf` stays as it is.** `findOriginal` still sets it, but ranking no longer reads it.
  - **Rank's two log lines use the same unit.** `Skipped by the current job filter rules: N` counts postings whose open copies all fail the rules, like `Open jobs: N` counts postings.

## Key code
- `src/db/schema.ts`: `jobs` has `source`, `dedupeKey` (not null), `applyUrl` (nullable), `descriptionText`, `companyId` (nullable; set by the ATS runner, null in tests that call `upsertJobs` without `opts.companyId`), `firstSeenAt`, `lastSeenAt`, `duplicateOf` and `closedAt`. Indexes are declared in the table's second argument, for example `index("jobs_dedupe_key_idx").on(t.dedupeKey)`. Migrations live in `drizzle/` (the latest is `0005_*`), and `openDb({ migrate: true })` applies them.
- `src/db/queries.ts`:
  - `upsertJobs(db, items, nowIso, opts?)` runs in `db.transaction((tx) => …)`.
  - For a new `(source, externalId)` it calls `tx.insert(jobs).values({ ...job, firstSeenAt: nowIso, lastSeenAt: nowIso, dedupeKey: key, duplicateOf: findOriginal(...), companyId })`.
  - For an existing row it calls `tx.update(jobs).set({ ...job, lastSeenAt, dedupeKey, closedAt: null, ... })`.
- `src/db/ranking.ts`:
  - `listOpenJobsForRanking(db, keep = () => true): RankableJob[]` selects the 12 `RankableJob` fields plus `source, duplicateOf, dedupeKey, applyUrl`. It groups in memory with `seenFamilies` / `seenApplyUrls` / `seenByKey`, and rows failing `keep` are skipped before grouping.
  - `RankableJob` = `id, title, company, location, url, departments, tags, salaryMin, salaryMax, salaryCurrency, salaryPeriod, descriptionText`.
- `src/db/ranking.test.ts`:
  - Helpers: `makeJob(externalId, over)` (source `"greenhouse"`, company `"Acme"`, title `` `Engineer ${externalId}` ``, `descriptionText` `` `Description ${externalId}` ``, `applyUrl: null`), `NOW = "2026-11-19T12:00:00.000Z"`, and `db`.
  - `describe("duplicates")` has `setClosedAt`, `ids()` and `insertThreeCities()`.
  - The test `the same title from another source is one job even when the text differs` inserts the Lever copy at `"2026-12-21T12:00:00.000Z"` and asserts `duplicateOf` is `[null, null]`.
- `src/db/queries.test.ts`: `makeJob(over)` helper; `describe("upsertJobs")`, `describe("duplicate marking")`.
- `src/scripts/rank-cli.ts`:
  - After loading the rules, it does `const ruleFilter = createRuleFilter(rules); const jobs = listOpenJobsForRanking(db, ruleFilter.keep); const skipped = ruleFilter.skipped();`.
  - It then logs `Skipped by the current job filter rules: ${skipped}` when skipped > 0.
  - With no jobs, it logs `No open jobs pass the current job filter rules.` (skipped > 0) or `No open jobs to rank. Run npm run fetch first.`.
- `src/scripts/rank-cli.test.ts`:
  - `beforeEach` stores four open greenhouse Acme jobs, ids 1–4 (`acme:a` React, `acme:b` Python, `acme:c` Node, `acme:d` "Mobile Developer"), and a closed `acme:e` (id 5). It also writes rules `{ keywords: ["developer", "engineer"] }`.
  - The test `a copy that passes the rules is ranked when the lowest-id copy fails` adds a Lever copy of `acme:d`, uses rules `{ keywords: ["react"] }`, and expects `"Skipped by the current job filter rules: 3"`.
- `src/ranking/rank.ts`: `createRuleFilter(rules): { keep; skipped }` (only `rank-cli.ts` uses it); tests in `describe("createRuleFilter")` in `rank.test.ts`.
- `src/core/job-filter-rules.ts:7`: the `JobFilterRulesSchema` doc comment ends with `Applied once, at fetch.`; `checkJobRules(job, rules)` returns `{ pass }`.

## Out of scope
- Claude scoring (M4b).
- Changing `findOriginal`, removing `duplicateOf`, or regrouping a job when it's updated.
- Calling `ensureJobGroups` from `npm run fetch` (rank does it; new rows are grouped at insert).
- Seniority, adapters, and any other review item.

## Tasks

### T1: Add `jobs.group_id`
- Depends on: none
- Files: `src/db/schema.ts`, the generated `drizzle/0006_*.sql` and `drizzle/meta/*` (from `npm run db:generate` only), `src/db/client.test.ts`
- Interfaces:
  - In `jobs`, after `closedAt`: `/** The posting this job belongs to: the lowest job id of its group (M4a). Null only until grouped. */ groupId: integer("group_id"),`
  - Add `index("jobs_group_id_idx").on(t.groupId)` to the indexes.
- Behavior: run `npm run db:generate`. The new migration only adds the column and the index. Open the generated SQL and check it contains `ADD \`group_id\` integer` and `CREATE INDEX \`jobs_group_id_idx\``. Don't edit it.
- Failure cases: if `db:generate` produces a table rebuild instead of `ALTER TABLE … ADD`, stop and ask.
- Tests first, in `client.test.ts`: `jobs has a nullable group_id column`.
  - `openDb({ url: ":memory:", migrate: true })`.
  - `db.all(sql\`PRAGMA table_info(jobs)\`)` has an entry with `name: "group_id"`, `type: "INTEGER"`, `notnull: 0`.
  - Import `sql` from `drizzle-orm` if the file doesn't already.
- Verify: `npm test -- src/db/client.test.ts` passes; a second `npx drizzle-kit generate` reports "No schema changes".
- Commit: `feat(m4): add jobs.group_id for posting groups (M4a T1)`
- [ ] Done

### T2: Assign posting groups
- Depends on: T1
- Files: `src/db/groups.ts` (new), `src/db/groups.test.ts` (new)
- Interfaces:
  ```ts
  export const GROUP_WINDOW_DAYS = 30;
  export type GroupInput = { id: number; source: string; dedupeKey: string; applyUrl: string | null; descriptionText: string; companyId: number | null; firstSeenAt: string };
  /** Decides the posting group of one job, sets its group_id (merging groups it strongly links) and returns the group id. */
  export function assignGroup(tx: Pick<Db, "select" | "update">, job: GroupInput): number;
  /** Groups every job whose group_id is null, in id order. Returns how many jobs it grouped. */
  export function ensureJobGroups(db: Db): number;
  ```
- Behavior (`assignGroup`):
  ```
  cutoff = (job.firstSeenAt - GROUP_WINDOW_DAYS days) as ISO
  live = jobs where groupId IS NOT NULL and id != job.id and lastSeenAt >= cutoff
  strongGroups = distinct groupId of live jobs where
      (job.applyUrl !== null and applyUrl = job.applyUrl)
      or (job.descriptionText !== "" and source = job.source and dedupeKey = job.dedupeKey and descriptionText = job.descriptionText)
      or (job.descriptionText !== "" and job.companyId !== null and companyId = job.companyId and descriptionText = job.descriptionText)
  if strongGroups not empty:
      target = min(strongGroups)
      update jobs set groupId = target where groupId in (strongGroups without target)   // merge
  else:
      weakGroups = distinct groupId of live jobs where dedupeKey = job.dedupeKey and source != job.source
      drop from weakGroups every group that has any job (any age) with source = job.source
      target = weakGroups not empty ? min(weakGroups) : job.id
  update jobs set groupId = target where id = job.id
  return target
  ```
  `ensureJobGroups`:
  - Select `id, source, dedupeKey, applyUrl, descriptionText, companyId, firstSeenAt` of jobs with `groupId IS NULL`, ordered by id.
  - Run `assignGroup` on each inside one `db.transaction`, and return the count.
- Failure cases:
  - No jobs, or none ungrouped: returns `0`.
  - An empty description never matches by description.
  - A null `applyUrl` never matches.
  - Jobs last seen before the cutoff are ignored.
- Tests first. Helper `groupsAfterBackfill()`: `db.update(jobs).set({ groupId: null }).run()`, then `ensureJobGroups(db)`, then return `db.select().from(jobs).orderBy(asc(jobs.id)).all().map((j) => j.groupId)`. Using it keeps these tests valid after T3, when inserts start grouping on their own. Insert jobs with `upsertJobs` (from `./queries`) and a local `makeJob` like the one in `ranking.test.ts`.
  - `copies on one board with the same description share a group`: three greenhouse "Same Title" jobs with `descriptionText: "Same description"` → `[1, 1, 1]`.
  - `the same title on one board with different descriptions is two postings`: descriptions `"Payments team"` and `"Infra team"` → `[1, 2]`.
  - `the same title from another job site joins the group`: greenhouse `makeJob("1", { title: "Same Title" })`, then lever `makeJob("9", { source: "lever", title: "Same Title" })` → `[1, 1]`.
  - `a shared apply URL joins the group`: two greenhouse jobs with default titles and `applyUrl: "https://apply.example.com/x"` → `[1, 1]`.
  - `a copy from another site doesn't hide a different opening`: greenhouse "Software Engineer in Test" `"Payments team"`, then a lever copy with the same title, then greenhouse "Software Engineer in Test" `"Infra team"` → `[1, 1, 3]`.
  - `an ambiguous copy joins the oldest group without merging`: greenhouse "Software Engineer in Test" `"Payments team"`, greenhouse "Software Engineer in Test" `"Infra team"`, then a lever copy → `[1, 2, 1]`.
  - `a job linking two groups merges them`:
    - lever `makeJob("1", { source: "lever", title: "Senior Engineer", applyUrl: "https://apply.example.com/u1" })`
    - ashby `makeJob("2", { source: "ashby", title: "Senior Engineer (Remote)", applyUrl: "https://apply.example.com/u2", descriptionText: "Same description" })`
    - ashby `makeJob("3", { source: "ashby", title: "Senior Engineer (Remote)", applyUrl: "https://apply.example.com/u1", descriptionText: "Same description" })`
    - → `[1, 1, 1]`.
  - `a job first seen more than 30 days after the other was last seen is another posting`: greenhouse `"Same Title"` at `NOW`, then lever `"Same Title"` at `"2026-12-20T12:00:00.000Z"` (31 days later) → `[1, 2]`.
  - `empty descriptions never match`: two greenhouse "Same Title" jobs with `descriptionText: ""` → `[1, 2]`.
  - `location variants on one company board share a group`:
    - Create a company with `insertOrGetCompany` (from `./companies`), as `rank-cli.test.ts` does.
    - Insert `makeJob("1", { title: "Senior Engineer - Real Estate - Brazil/Remote", descriptionText: "Same description" })` and `makeJob("2", { title: "Senior Engineer - Real Estate - Colombia/Remote", descriptionText: "Same description" })` with `{ companyId }`.
    - → `[1, 1]`.
  - `different titles with the same description stay apart without a company`: the same two jobs inserted without `companyId` → `[1, 2]`.
  - `different descriptions on one company board stay apart`: the same two titles with `{ companyId }` but descriptions `"Payments team"` and `"Infra team"` → `[1, 2]`.
  - `ensureJobGroups counts the jobs it grouped and is idempotent`: insert two jobs, set both `groupId` to null; `ensureJobGroups(db)` is `2`, then `0`.
- Verify: `npm test -- src/db/groups.test.ts` passes.
- Commit: `feat(m4): assign posting groups (M4a T2)`
- [ ] Done

### T3: Group jobs when they're stored
- Depends on: T2
- Files: `src/db/queries.ts`, `src/db/queries.test.ts`
- Behavior:
  - In `upsertJobs`, insert the new row with `.returning({ id: jobs.id }).get()`.
  - Then call `assignGroup(tx, { id, source: job.source, dedupeKey: key, applyUrl: job.applyUrl, descriptionText: job.descriptionText, companyId: opts.companyId ?? null, firstSeenAt: nowIso })`.
  - The update branch doesn't change `groupId`.
- Failure cases: a failure inside `assignGroup` rolls back the whole `upsertJobs` transaction, as any other DB error does.
- Tests first, in a new `describe("posting groups")` in `queries.test.ts`, using its `makeJob(over)`:
  - `a new job gets its own group`: insert one job → its `groupId` is `1`.
  - `a copy stored later joins the group`: insert `makeJob({ externalId: "a", title: "Same Title" })`, then, in a separate call, `makeJob({ source: "lever", externalId: "b", title: "Same Title" })`. Read `groupId` of both → `[1, 1]`.
  - `updating a job keeps its group`:
    - Insert greenhouse `"Same Title"` with `descriptionText: "One"` (id 1), and greenhouse `"Same Title"` with `descriptionText: "Two"` and another `externalId` (id 2). The groups are `[1, 2]`.
    - Upsert job 2 again with `descriptionText: "One"`. The groups stay `[1, 2]`.

  Use whatever `externalId` / `source` fields the local `makeJob` supports, and read the helper before writing.
- Verify: `npm test -- src/db/queries.test.ts src/db/groups.test.ts` passes.
- Commit: `feat(m4): group each job when it is stored (M4a T3)`
- [ ] Done

### T4: Ranking reads the stored groups
- Depends on: T3
- Files: `src/db/ranking.ts`, `src/db/ranking.test.ts`
- Interfaces:
  ```ts
  export function listOpenJobsForRanking(db: Db, keep: (job: RankableJob) => boolean = () => true): RankableJob[]; // unchanged signature
  /** How many postings (groups) have at least one open job. */
  export function countOpenPostings(db: Db): number;
  ```
- Behavior:
  - `listOpenJobsForRanking` selects the 12 `RankableJob` fields plus `groupId` from open jobs, ordered by id. For each row:
    - skip it if `!keep(job)`;
    - `g = groupId ?? id`; skip it if `g` has been seen;
    - otherwise remember `g` and push the job without `groupId`.
  - Remove the `seenFamilies` / `seenApplyUrls` / `seenByKey` logic. Doc comment: "Open jobs to rank, in id order, one per posting group (`jobs.group_id`, assigned when a job is stored). The lowest open id of a group that passes `keep` is ranked, so a passing copy still stands for its posting."
  - `countOpenPostings` is `count(distinct coalesce(group_id, id))` over open jobs.
- Failure cases:
  - No open jobs: `[]` and `0`.
  - A job with a null `groupId` counts as its own group.
- Tests first:
  - In `the same title from another source is one job even when the text differs`, insert the Lever copy at `NOW` instead of `"2026-12-21T12:00:00.000Z"`, and delete the `duplicateOf` assertion (`findOriginal` now links them, which doesn't matter here). The expectation stays `[1]`. The 32-day gap now makes them separate postings by design; the next test covers that.
  - `the same title on another site long after is another job`: greenhouse `"Same Title"` at `NOW`, lever `"Same Title"` at `"2026-12-21T12:00:00.000Z"` → ids `[1, 2]`.
  - `a copy from another site doesn't hide a different opening`: greenhouse "Software Engineer in Test" `"Payments team"`, a lever copy, then greenhouse "Software Engineer in Test" `"Infra team"` (separate calls) → ids `[1, 3]`.
  - `countOpenPostings counts groups with an open job`: `insertThreeCities()` plus `makeJob("4")` → `2`; after closing 4 → `1`.
  - Every other existing test stays unchanged and must pass. Before the fix, `a copy from another site doesn't hide a different opening` gives `[1]` and `countOpenPostings` doesn't exist; confirm both fail first.
- Verify: `npm test -- src/db/ranking.test.ts src/ranking/embed-jobs.test.ts` passes.
- Commit: `fix(m4): ranking reads the stored posting groups (M4a T4)`
- [ ] Done

### T5: Rank backfills groups and counts skipped postings
- Depends on: T4
- Files: `src/scripts/rank-cli.ts`, `src/scripts/rank-cli.test.ts`
- Behavior: after `const db = deps.openDb();`:
  ```
  const grouped = ensureJobGroups(db)
  if grouped > 0: log `Assigned posting groups to ${grouped} jobs`
  const jobs = listOpenJobsForRanking(db, (job) => checkJobRules(job, rules).pass)
  const skipped = countOpenPostings(db) - jobs.length
  ```
  The rest is unchanged: the skipped and empty-result messages, and the comment about checking rules before grouping. Remove the `createRuleFilter` import.
- Failure cases: an empty DB still logs `No open jobs to rank. Run npm run fetch first.` and `Assigned…` isn't logged.
- Tests first:
  - In `a copy that passes the rules is ranked when the lowest-id copy fails`, change `"Skipped by the current job filter rules: 3"` to `"Skipped by the current job filter rules: 2"`. Python, Node and the Mobile posting (both copies) form 3 postings, and the Mobile posting is kept through its Lever copy, so 2 postings are skipped. This is the decided unit change.
  - `groups jobs stored before posting groups existed`:
    - `db.update(jobs).set({ groupId: null }).run()`, importing `jobs` from `@/db/schema`.
    - `run()` returns 0, and `logs` contains `"Assigned posting groups to 5 jobs"` and `"Open jobs: 4"`.
- Verify: `npm test -- src/scripts/rank-cli.test.ts` passes; `npm run typecheck` passes.
- Commit: `fix(m4): rank backfills posting groups and counts skipped postings (M4a T5)`
- [ ] Done

### T6: Cleanups
- Depends on: T5
- Files: `src/ranking/rank.ts`, `src/ranking/rank.test.ts`, `src/core/job-filter-rules.ts`
- Behavior:
  - Delete `createRuleFilter` and its `describe("createRuleFilter")` tests; nothing uses it after T5. Remove the now-unused imports in `rank.ts` and the `input` helper in `rank.test.ts` if nothing else uses it.
  - In `job-filter-rules.ts`, change the doc comment to `/** Every job filter the user controls (config/job-filter-rules.json). Applied at fetch and re-checked by npm run rank. */`.
- Failure cases: none.
- Tests first: none (removal and a comment). Confirm `grep -rn "createRuleFilter" src` prints nothing.
- Verify: `npm test -- src/ranking/rank.test.ts` passes; `npm run lint && npm run typecheck` pass.
- Commit: `refactor(m4): remove createRuleFilter and fix the rules comment (M4a T6)`
- [ ] Done

### T7: Wrap-up
- Depends on: T1–T6
- Files: `PLAN.md`
- Behavior: append to the end of `PLAN.md`: `- <today's date>: M4a: every job stores a group_id (its posting), decided when it is stored: a shared apply URL, the same board + title + description, or the same company board + description whatever the title (location variants), merges groups; the same company and title from another job site joins the oldest group that has no job from the new job's board; only jobs seen within 30 days count. Ranking keeps the lowest open id per group that passes the rules, and npm run rank backfills groups for older rows. Scores in M4b are checked per group.`
- Failure cases: none (docs only).
- Verify: `tail -1 PLAN.md` shows the line.
- Commit: `docs(m4): record the M4a posting groups (M4a T7)`
- [ ] Done

## Milestone verification
1. `nvm use && npm run lint && npm run typecheck && npm test && npm run test:coverage` pass, including the thresholds.
2. `npx drizzle-kit generate` reports "No schema changes".
3. Real DB. First back it up: `cp data/jobs.db data/backup/jobs-before-m4a.db` (also copy `jobs.db-wal` if present). Then `npm run rank -- --top 10`:
   - It logs `Assigned posting groups to 159 jobs` (or the current row count) and `Open jobs: 145`, if the DB still has the 159 jobs from the 2026-11-24 rebuild. Otherwise report the numbers.
   - The Truelogic "…Real Estate - …/Remote" variants appear once in the ranking.
   - `sqlite3 -readonly data/jobs.db "select count(*) from jobs where group_id is null"` prints `0`.
   - A second `npm run rank -- --top 10` doesn't log `Assigned…`.
4. `git log --oneline 943f5d7..` shows the spec commit plus 7 task commits. `git status --short` is clean.

## Gotchas
- **Use the generated migration.** Run `npm run db:generate`; never hand-write or edit files in `drizzle/`.
- **`assignGroup` only looks at grouped rows** (`groupId IS NOT NULL`). That's what makes the id-order backfill equal to insert-time grouping.
- **Merge before setting the new job's group,** and merge with one `update … where groupId in (…)`, not row by row.
- **The weak-match exclusion checks the group's members of any age**, not only jobs inside the 30-day window.
- **`insert … returning` in Drizzle with better-sqlite3:** use `.returning({ id: jobs.id }).get()` inside the transaction.
- **Strip `groupId` from `RankableJob`** in T4. M4b adds it back on purpose; the exact-fields test checks the shape.

## Open questions / assumptions
None.
