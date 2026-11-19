import { describe, expect, it } from "vitest";
import { toIsoUtc } from "./dates";

describe("toIsoUtc", () => {
  it("handles epoch seconds", () => {
    expect(toIsoUtc(1794153615)).toBe("2026-11-08T16:00:15.000Z");
  });

  it("treats naive strings as UTC", () => {
    expect(toIsoUtc("2026-11-07T01:10:55")).toBe("2026-11-07T01:10:55.000Z");
  });

  it("parses offsets", () => {
    expect(toIsoUtc("2026-11-09T08:52:38-05:00")).toBe("2026-11-09T13:52:38.000Z");
  });

  it("parses RFC 2822", () => {
    expect(toIsoUtc("Sun, 18 Oct 2026 07:31:05 +0000")).toBe("2026-10-18T07:31:05.000Z");
  });

  it("returns null for garbage", () => {
    expect(toIsoUtc("not a date")).toBeNull();
    expect(toIsoUtc("")).toBeNull();
    expect(toIsoUtc(null)).toBeNull();
    expect(toIsoUtc(undefined)).toBeNull();
  });

  it("accepts a space separator, missing seconds and fractional seconds in naive strings", () => {
    expect(toIsoUtc("2026-11-07 01:10:55")).toBe("2026-11-07T01:10:55.000Z");
    expect(toIsoUtc("2026-11-07T01:10")).toBe("2026-11-07T01:10:00.000Z");
    expect(toIsoUtc("2026-11-07T01:10:55.123")).toBe("2026-11-07T01:10:55.123Z");
  });

  it("keeps an explicit Z and trims surrounding whitespace", () => {
    expect(toIsoUtc("  2026-11-07T01:10:55Z  ")).toBe("2026-11-07T01:10:55.000Z");
  });

  it("treats date-only strings as UTC midnight", () => {
    expect(toIsoUtc("2026-11-07")).toBe("2026-11-07T00:00:00.000Z");
  });

  it("treats epoch 0 as a valid date, not as missing", () => {
    expect(toIsoUtc(0)).toBe("1970-01-01T00:00:00.000Z");
  });

  it("returns null for whitespace-only and non-finite or out-of-range numbers", () => {
    expect(toIsoUtc("   ")).toBeNull();
    expect(toIsoUtc(Number.NaN)).toBeNull();
    expect(toIsoUtc(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toIsoUtc(1e20)).toBeNull();
  });

  it("returns null for an impossible naive date", () => {
    expect(toIsoUtc("2026-13-45T00:00:00")).toBeNull();
  });
});
