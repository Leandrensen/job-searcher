import { expect } from "vitest";

/** Asserts a description text starts with `firstLine` and has no leftover HTML tags or entities. */
export function expectCleanText(text: string, firstLine: string): void {
  expect(text.startsWith(firstLine), `expected text to start with ${JSON.stringify(firstLine)}, got ${JSON.stringify(text.slice(0, firstLine.length + 20))}`).toBe(true);
  expect(text).not.toMatch(/<\/?[a-z][^>]*>/i);
  expect(text).not.toMatch(/&(?:[a-z]+|#\d+|#x[0-9a-f]+);/i);
}
