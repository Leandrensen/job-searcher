import { arbeitnow } from "./boards/arbeitnow";
import { getonboard } from "./boards/getonboard";
import { himalayas } from "./boards/himalayas";
import { hnHiring } from "./boards/hn-hiring";
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
  getonboard,
  remotive,
  himalayas,
  jobicy,
  workingnomads,
  arbeitnow,
  hnHiring,
];
