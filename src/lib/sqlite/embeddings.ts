import type { EmbeddingProvider as FrameworkEmbeddingProvider } from "../types.ts";

/** The supplied single-text interface, adapted to the framework's batched providers. */
export interface EmbeddingProvider {
  readonly dimensions: number;
  readonly fingerprint: string;
  readonly available?: boolean;
  embed(text: string, purpose?: "query" | "document", signal?: AbortSignal): Promise<Float32Array>;
  embedBatch(
    texts: readonly string[],
    purpose?: "query" | "document",
    signal?: AbortSignal,
  ): Promise<readonly Float32Array[]>;
}

/** Preserve query/document prefixes, cancellation, and provider ownership at this boundary. */
export function toIndexEmbeddingProvider(provider: FrameworkEmbeddingProvider): EmbeddingProvider {
  return {
    dimensions: provider.dimensions,
    fingerprint: provider.fingerprint,
    available: true,
    async embed(text, purpose = "document", signal) {
      const vectors = await provider.embed([text], purpose, signal);
      const vector = vectors[0];
      if (vectors.length !== 1 || vector === undefined) {
        throw new Error("Embedding provider returned an incorrect vector count.");
      }
      return new Float32Array(vector);
    },
    async embedBatch(texts, purpose = "document", signal) {
      const vectors = await provider.embed(texts, purpose, signal);
      if (vectors.length !== texts.length) {
        throw new Error("Embedding provider returned an incorrect vector count.");
      }
      return vectors.map((vector) => new Float32Array(vector));
    },
  };
}
