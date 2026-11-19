// Live check: loads the real model (about 340 MB, downloaded on the first run). Run with `npm run test:live`.
import { describe, expect, it } from "vitest";
import { createTransformersEmbedder } from "./transformers-embedder";
import { cosine } from "./vectors";

describe("transformers embedder (live)", () => {
  it(
    "embeds English and Spanish into the same space",
    async () => {
      const embedder = await createTransformersEmbedder();
      const [english, spanish, cook] = await embedder.embed([
        "Senior React developer, remote",
        "Desarrollador React senior, remoto",
        "Experienced line cook for a busy restaurant",
      ]);
      for (const v of [english!, spanish!, cook!]) {
        expect(v).toHaveLength(768);
        expect(Math.abs(Math.sqrt(v.reduce((sum, x) => sum + x * x, 0)) - 1)).toBeLessThan(1e-3);
      }
      expect(cosine(english!, spanish!)).toBeGreaterThan(cosine(english!, cook!));
    },
    600_000,
  );
});
