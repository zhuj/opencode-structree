import { createHash } from "node:crypto";
import type { ChunkingConfig, EmbeddedChunk, EmbeddingProvider, TextChunk } from "./types.ts";

/** Offsets count Unicode code points, so a boundary never splits a surrogate pair. */
export function chunkText(text: string, config: ChunkingConfig): TextChunk[] {
  validateChunking(config);
  const points = Array.from(text);
  const chunks: TextChunk[] = [{ index: 0, text, start: 0, end: points.length }];
  const step = config.size - Math.floor(config.size * config.overlap);
  for (let start = 0; start < points.length; start += step) {
    const end = Math.min(start + config.size, points.length);
    chunks.push({ index: chunks.length, text: points.slice(start, end).join(""), start, end });
    if (end === points.length) break;
  }
  return chunks;
}

export function validateChunking(config: ChunkingConfig): void {
  if (!Number.isSafeInteger(config.size) || config.size < 1) {
    throw new RangeError("chunking.size must be a positive integer of Unicode code points");
  }
  if (!Number.isFinite(config.overlap) || config.overlap < 0 || config.overlap >= 1) {
    throw new RangeError("chunking.overlap must be a fraction from 0 (inclusive) to 1 (exclusive)");
  }
}

export function embeddingFingerprint(provider: EmbeddingProvider, config: ChunkingConfig): string {
  validateChunking(config);
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: "object-mcp/codepoint-chunks/v1",
        provider: provider.fingerprint,
        size: config.size,
        overlap: config.overlap,
        overlapPoints: Math.floor(config.size * config.overlap),
      }),
    )
    .digest("hex");
}

export async function embedChunks(
  provider: EmbeddingProvider,
  chunks: readonly TextChunk[],
  signal?: AbortSignal,
): Promise<EmbeddedChunk[]> {
  signal?.throwIfAborted();
  // Small files have identical whole-file and part text; avoid paying/inferencing twice.
  const unique = [...new Set(chunks.map((chunk) => chunk.text))];
  const vectors = await provider.embed(unique, "document", signal);
  signal?.throwIfAborted();
  if (vectors.length !== unique.length)
    throw new Error("Embedding provider returned an incorrect vector count");
  const byText = new Map(unique.map((text, index) => [text, vectors[index]]));
  return chunks.map((chunk) => {
    const vector = byText.get(chunk.text);
    if (!vector) throw new Error("Embedding provider returned a missing vector");
    return { ...chunk, vector };
  });
}
