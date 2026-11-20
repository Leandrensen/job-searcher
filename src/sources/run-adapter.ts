import { HttpError } from "@/core/http";
import { JobSchema, type Job } from "@/core/job";
import { matchesKeywords } from "@/core/job-filter-rules";
import { isTechJob } from "@/core/tech-filter";
import type { AnyAdapter, FetchContext, FetchResult } from "./types";

const MAX_LOGGED_FAILURES = 3;

export async function runAdapter(adapter: AnyAdapter, ctx: FetchContext): Promise<FetchResult> {
  const start = Date.now();
  const result: FetchResult = {
    source: adapter.id,
    status: "success",
    fetched: 0,
    invalid: 0,
    filtered: 0,
    jobs: [],
    latestPostedAt: null,
    error: null,
    durationMs: 0,
  };

  let items: unknown[];
  try {
    items = await adapter.fetch(ctx);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    return {
      ...result,
      status: "error",
      error: `${e.name}: ${e.message}`,
      ...(err instanceof HttpError ? { httpStatus: err.status } : {}),
      durationMs: Date.now() - start,
    };
  }

  result.fetched = items.length;
  const seen = new Set<string>();
  let logged = 0;
  const logFailure = (msg: string) => {
    if (logged++ < MAX_LOGGED_FAILURES) ctx.log(`${adapter.id}: ${msg}`);
  };

  for (const item of items) {
    const parsed = adapter.itemSchema.safeParse(item);
    if (!parsed.success) {
      result.invalid++;
      const issue = parsed.error.issues[0];
      logFailure(`invalid item at ${issue?.path.join(".") || "(root)"}: ${issue?.message}`);
      continue;
    }

    let job: Job | null;
    try {
      job = adapter.normalize(parsed.data);
    } catch (err) {
      result.invalid++;
      logFailure(`normalize threw: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (!job) {
      result.invalid++;
      continue;
    }

    const valid = JobSchema.safeParse(job);
    if (!valid.success) {
      result.invalid++;
      const issue = valid.error.issues[0];
      logFailure(`invalid job at ${issue?.path.join(".") || "(root)"}: ${issue?.message}`);
      continue;
    }

    const posted = valid.data.postedAt;
    if (posted !== null && (result.latestPostedAt === null || posted > result.latestPostedAt)) result.latestPostedAt = posted;

    if (seen.has(valid.data.externalId)) continue;
    seen.add(valid.data.externalId);

    // Boards keep only postings matching the user's keywords. Without rules, the old built-in list applies (temporary).
    const wanted = ctx.rules ? matchesKeywords(valid.data, ctx.rules.keywords) : isTechJob(valid.data);
    if (adapter.techFilter && !wanted) {
      result.filtered++;
      continue;
    }
    result.jobs.push(valid.data);
  }

  result.durationMs = Date.now() - start;
  return result;
}
