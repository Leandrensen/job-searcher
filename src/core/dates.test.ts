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
});
