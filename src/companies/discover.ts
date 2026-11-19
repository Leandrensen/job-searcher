import type { BoardId, Job } from "@/core/job";
import type { Db } from "@/db/client";
import { upsertCandidate } from "@/db/companies";
import { boardUrl, extractAtsRefs } from "./slugs";

/**
 * Boards only discover companies: each job becomes (or enriches) a candidate, together with any ATS board
 * links found in the posting. `updated` counts candidates that already existed, whether or not they changed.
 */
export function recordCandidatesFromBoardJobs(
  db: Db,
  board: BoardId,
  jobs: Job[],
  nowIso: string,
): { inserted: number; updated: number } {
  let inserted = 0;
  let updated = 0;
  for (const job of jobs) {
    const atsHints = extractAtsRefs([job.url, job.applyUrl ?? "", job.descriptionHtml].join(" ")).map(boardUrl);
    const result = upsertCandidate(db, { name: job.company, atsHints, origin: `board:${board}` }, nowIso);
    if (result === "inserted") inserted++;
    else updated++;
  }
  return { inserted, updated };
}
