/** Turns texts into vectors. The real one runs a model locally; tests use a fake. */
export interface Embedder {
  /** Stored with each vector, so a different model re-embeds everything. */
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}
