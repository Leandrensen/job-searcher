import { getonboard } from "./boards/getonboard";
import { remotive } from "./boards/remotive";
import { himalayas } from "./boards/himalayas";
import { jobicy } from "./boards/jobicy";
import { remoteok } from "./boards/remoteok";
import { weworkremotely } from "./boards/weworkremotely";
import type { AnyAdapter } from "./types";

export const adapters: AnyAdapter[] = [remoteok, weworkremotely, getonboard, remotive, himalayas, jobicy];

export function getAdapter(id: string): AnyAdapter | undefined {
  return adapters.find((a) => a.id === id);
}
