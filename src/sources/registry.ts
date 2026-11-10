import { remoteok } from "./boards/remoteok";
import type { AnyAdapter } from "./types";

export const adapters: AnyAdapter[] = [remoteok];

export function getAdapter(id: string): AnyAdapter | undefined {
  return adapters.find((a) => a.id === id);
}
