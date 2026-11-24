import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildEmbeddingText, cosine, EMBED_MAX_CHARS, textHash } from "./vectors";

describe("buildEmbeddingText", () => {
  it("joins the title and the description", () => {
    expect(buildEmbeddingText({ title: " Dev ", descriptionText: " Build things. " })).toBe("Dev\n\nBuild things.");
  });

  it("an empty description gives just the title", () => {
    expect(buildEmbeddingText({ title: "Dev", descriptionText: "" })).toBe("Dev");
  });

  it("cuts long descriptions to 6000 characters", () => {
    const text = buildEmbeddingText({ title: "Dev", descriptionText: "x".repeat(10_000) });
    expect(EMBED_MAX_CHARS).toBe(6000);
    expect(text).toHaveLength(6000);
  });
});

describe("textHash", () => {
  it("is a sha256 of the model and the text", () => {
    const expected = createHash("sha256").update("m\nt").digest("hex");
    expect(textHash("m", "t")).toBe(expected);
    expect(expected).toHaveLength(64);
  });

  it("changes with the model or the text", () => {
    expect(textHash("m", "t")).toBe(textHash("m", "t"));
    expect(textHash("m2", "t")).not.toBe(textHash("m", "t"));
    expect(textHash("m", "t2")).not.toBe(textHash("m", "t"));
  });
});

describe("cosine", () => {
  const v = (...n: number[]) => new Float32Array(n);

  it.each([
    [v(1, 0), v(1, 0), 1],
    [v(1, 0), v(0, 1), 0],
    [v(1, 0), v(-1, 0), -1],
    [v(0, 0), v(1, 0), 0],
    [v(2, 0), v(3, 0), 1],
  ])("%j · %j = %j", (a, b, expected) => {
    expect(cosine(a, b)).toBeCloseTo(expected, 6);
  });

  it("different lengths throw", () => {
    expect(() => cosine(v(1, 0, 0), v(1, 0))).toThrow("cosine: vectors have different lengths (3 vs 2)");
  });
});
