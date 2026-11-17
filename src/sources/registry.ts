import type { AtsId } from "@/core/job";
import type { ProbeFn } from "@/companies/types";
import { ashby, probeAshby } from "./ats/ashby";
import { greenhouse, probeGreenhouse } from "./ats/greenhouse";
import { lever, probeLever } from "./ats/lever";
import { probeRecruitee, recruitee } from "./ats/recruitee";
import { probeSmartRecruiters, smartrecruiters } from "./ats/smartrecruiters";
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
export const atsAdapters: AnyAdapter[] = [greenhouse, lever, ashby, recruitee, smartrecruiters];

/** Enabled sources, in the order they run and appear in summaries. */
export const adapters: AnyAdapter[] = [...boardAdapters, ...atsAdapters];

export const atsProbes: Record<AtsId, ProbeFn> = {
  greenhouse: probeGreenhouse,
  lever: probeLever,
  ashby: probeAshby,
  recruitee: probeRecruitee,
  smartrecruiters: probeSmartRecruiters,
};
