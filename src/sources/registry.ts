import { arbeitnow } from "./boards/arbeitnow";
import { himalayas } from "./boards/himalayas";
import { jobicy } from "./boards/jobicy";
import { remoteok } from "./boards/remoteok";
import { remotive } from "./boards/remotive";
import { weworkremotely } from "./boards/weworkremotely";
import { workingnomads } from "./boards/workingnomads";
import type { AnyAdapter } from "./types";

/** Enabled sources, in the order they run and appear in the fetch summary. */
export const adapters: AnyAdapter[] = [
  remoteok,
  weworkremotely,
  remotive,
  himalayas,
  jobicy,
  workingnomads,
  arbeitnow,
];
