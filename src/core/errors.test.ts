import { describe, expect, it } from "vitest";
import { errorMessage } from "./errors";

describe("errorMessage", () => {
  it("prefixes the error name", () => {
    expect(errorMessage(new TypeError("bad"))).toBe("TypeError: bad");
  });

  it("wraps non-Error values", () => {
    expect(errorMessage("boom")).toBe("Error: boom");
  });
});
