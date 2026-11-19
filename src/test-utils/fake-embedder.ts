import type { Embedder } from "@/ranking/embedder";

const AXES = ["react", "node", "python"];

/**
 * A deterministic embedder for tests: the three axes count how often "react", "node" and "python" appear
 * (case-insensitive). A tiny value on every axis keeps vectors from being all zeros. Vectors are normalized.
 */
export function createFakeEmbedder(opts: { model?: string; fail?: (callIndex: number) => boolean } = {}): Embedder & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    model: opts.model ?? "fake-1",
    dimensions: AXES.length,
    calls,
    async embed(texts) {
      const callIndex = calls.length;
      calls.push([...texts]);
      if (opts.fail?.(callIndex)) throw new Error("model crashed");
      return texts.map((text) => {
        const lower = text.toLowerCase();
        const raw = AXES.map((word) => lower.split(word).length - 1 + 1e-6);
        const norm = Math.sqrt(raw.reduce((sum, x) => sum + x * x, 0));
        return new Float32Array(raw.map((x) => x / norm));
      });
    },
  };
}
