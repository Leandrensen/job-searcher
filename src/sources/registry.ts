import { getonboard } from "./boards/getonboard";
import { remotive } from "./boards/remotive";
import { remoteok } from "./boards/remoteok";
import { weworkremotely } from "./boards/weworkremotely";
import type { AnyAdapter } from "./types";

export const adapters: AnyAdapter[] = [remoteok, weworkremotely, getonboard, remotive];

export function getAdapter(id: string): AnyAdapter | undefined {
  return adapters.find((a) => a.id === id);
}
