import type { Embedder } from "./embedder";

export const EMBEDDING_MODEL = "onnx-community/gte-multilingual-base";
export const EMBEDDING_DTYPE = "q8";
const DIMENSIONS = 768;

/**
 * The real embedder: a multilingual model that runs locally with Transformers.js (CLS pooling, normalized, no
 * prefixes). The model is downloaded on first use and cached in `cacheDir`. It is imported lazily, so nothing
 * that doesn't call this loads the library.
 */
export async function createTransformersEmbedder(opts: { cacheDir?: string } = {}): Promise<Embedder> {
  const { env, pipeline } = await import("@huggingface/transformers");
  env.cacheDir = opts.cacheDir ?? "data/models";
  const extractor = await pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: EMBEDDING_DTYPE });
  return {
    model: `${EMBEDDING_MODEL}:${EMBEDDING_DTYPE}`,
    dimensions: DIMENSIONS,
    async embed(texts) {
      const output = await extractor(texts, { pooling: "cls", normalize: true });
      return (output.tolist() as number[][]).map((row) => Float32Array.from(row));
    },
  };
}
