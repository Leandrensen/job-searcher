import { getonboard } from "./boards/getonboard";
import { remotive } from "./boards/remotive";
import { arbeitnow } from "./boards/arbeitnow";
import { himalayas } from "./boards/himalayas";
import { jobicy } from "./boards/jobicy";
import { workingnomads } from "./boards/workingnomads";
import { remoteok } from "./boards/remoteok";
import { weworkremotely } from "./boards/weworkremotely";
import type { AnyAdapter } from "./types";

export const adapters: AnyAdapter[] = [remoteok, weworkremotely, getonboard, remotive, himalayas, jobicy, workingnomads, arbeitnow];

export function getAdapter(id: string): AnyAdapter | undefined {
  return adapters.find((a) => a.id === id);
}
