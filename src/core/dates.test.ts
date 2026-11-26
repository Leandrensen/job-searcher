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

  it("handles epoch zero and fractional epoch seconds", () => {
    expect(toIsoUtc(0)).toBe("1970-01-01T00:00:00.000Z");
    expect(toIsoUtc(1794153615.5)).toBe("2026-11-08T16:00:15.500Z");
  });

  it("returns null for non-finite or out-of-range numbers", () => {
    expect(toIsoUtc(Number.NaN)).toBeNull();
    expect(toIsoUtc(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toIsoUtc(1e20)).toBeNull();
  });

  it("treats space-separated naive strings, with or without seconds, as UTC", () => {
    expect(toIsoUtc("2026-11-07 01:10:55")).toBe("2026-11-07T01:10:55.000Z");
    expect(toIsoUtc("2026-11-07 01:10")).toBe("2026-11-07T01:10:00.000Z");
    expect(toIsoUtc("2026-11-07T01:10:55.5")).toBe("2026-11-07T01:10:55.500Z");
  });

  it("trims surrounding whitespace and returns null for blank strings", () => {
    expect(toIsoUtc("  2026-11-07T01:10:55  ")).toBe("2026-11-07T01:10:55.000Z");
    expect(toIsoUtc("   ")).toBeNull();
  });

  it("keeps explicit Z and date-only strings as UTC", () => {
    expect(toIsoUtc("2026-11-07T01:10:55Z")).toBe("2026-11-07T01:10:55.000Z");
    expect(toIsoUtc("2026-11-07")).toBe("2026-11-07T00:00:00.000Z");
  });

  it("returns null for well-formed but impossible dates", () => {
    expect(toIsoUtc("2026-13-45T01:10:55")).toBeNull();
  });
});
