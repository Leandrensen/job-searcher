/** `Name: message` for any thrown value, as stored in run records and logs. */
export function errorMessage(err: unknown): string {
  const e = err instanceof Error ? err : new Error(String(err));
  return `${e.name}: ${e.message}`;
}
