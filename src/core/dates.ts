const NAIVE_ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/** Epoch seconds, ISO strings (naive ones are UTC) and RFC 2822 strings to a UTC ISO string, or null. */
export function toIsoUtc(input: string | number | null | undefined): string | null {
  if (input === null || input === undefined || input === "") return null;
  let date: Date;
  if (typeof input === "number") {
    date = new Date(input * 1000);
  } else {
    const s = input.trim();
    date = new Date(NAIVE_ISO.test(s) ? `${s.replace(" ", "T")}Z` : s);
  }
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** `iso` moved by `days` whole days (negative goes back), as a UTC ISO string. */
export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString();
}
