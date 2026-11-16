import type { AtsId } from "@/core/job";
import type { ProbeFn } from "@/companies/types";
import { ashby, probeAshby } from "./ats/ashby";
import { greenhouse, probeGreenhouse } from "./ats/greenhouse";
import { lever, probeLever } from "./ats/lever";
import { arbeitnow } from "./boards/arbeitnow";
import { himalayas } from "./boards/himalayas";
import { jobicy } from "./boards/jobicy";
import { remoteok } from "./boards/remoteok";
import { remotive } from "./boards/remotive";
import { weworkremotely } from "./boards/weworkremotely";
import { workingnomads } from "./boards/workingnomads";
import type { AnyAdapter } from "./types";

/** Job boards: from M2 they only discover companies, and their jobs are never stored. */
export const boardAdapters: AnyAdapter[] = [
  remoteok,
  weworkremotely,
  remotive,
  himalayas,
  jobicy,
  workingnomads,
  arbeitnow,
];

/** ATSs: the only source of stored jobs. Each task of M2 Part D adds one. */
export const atsAdapters: AnyAdapter[] = [greenhouse, lever, ashby];

/** Enabled sources, in the order they run and appear in summaries. */
export const adapters: AnyAdapter[] = [...boardAdapters, ...atsAdapters];

// TODO(M2 T16): make this a full Record<AtsId, ProbeFn> once all 6 ATS adapters exist.
export const atsProbes: Partial<Record<AtsId, ProbeFn>> = {
  greenhouse: probeGreenhouse,
  lever: probeLever,
  ashby: probeAshby,
};
