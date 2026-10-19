import { createHash } from "node:crypto";

export class EmbeddingError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EmbeddingError";
    this.code = code;
  }
}

export function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function normalizeVector(values: ArrayLike<number>, dimensions: number): Float32Array {
  if (values.length !== dimensions) {
    throw new EmbeddingError(
      "DIMENSION_MISMATCH",
      `Expected ${dimensions} embedding dimensions, received ${values.length}`,
    );
  }
  let squaredNorm = 0;
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new EmbeddingError("INVALID_VECTOR", "Embedding vector contains a non-finite number");
    squaredNorm += value * value;
  }
  if (!Number.isFinite(squaredNorm) || squaredNorm <= 0) {
    throw new EmbeddingError("INVALID_VECTOR", "Embedding vector must have a finite, nonzero norm");
  }
  const scale = 1 / Math.sqrt(squaredNorm);
  return Float32Array.from(values, (value) => value * scale);
}

export function weightedMean(
  vectors: readonly Float32Array[],
  weights: readonly number[],
  dimensions: number,
): Float32Array {
  const first = vectors[0];
  if (!first || vectors.length !== weights.length) {
    throw new EmbeddingError(
      "INVALID_VECTOR",
      "Cannot aggregate an empty or mismatched embedding set",
    );
  }
  if (vectors.length === 1) return normalizeVector(first, dimensions);
  const mean = new Float64Array(dimensions);
  let totalWeight = 0;
  for (const [index, vector] of vectors.entries()) {
    const weight = weights[index];
    if (
      typeof weight !== "number" ||
      !Number.isFinite(weight) ||
      weight <= 0 ||
      vector.length !== dimensions
    ) {
      throw new EmbeddingError(
        "INVALID_VECTOR",
        "Cannot aggregate invalid embedding dimensions or weights",
      );
    }
    totalWeight += weight;
    for (const [column, value] of vector.entries()) {
      // biome-ignore lint/style/noNonNullAssertion: The typed-array index is bounded by the dimensions validated above.
      mean[column] = mean[column]! + value * weight;
    }
  }
  mean.forEach((value, column) => {
    mean[column] = value / totalWeight;
  });
  return normalizeVector(mean, dimensions);
}

/** Internal provider windows are disjoint; persistent retrieval chunks have their own overlap. */
export function splitUtf8(text: string, maxBytes: number): string[] {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new RangeError("maxBytes must be positive");
  const windows: string[] = [];
  let window = "";
  let bytes = 0;
  for (const point of text) {
    const pointBytes = Buffer.byteLength(point, "utf8");
    if (pointBytes > maxBytes) {
      throw new EmbeddingError(
        "INPUT_LIMIT",
        "Embedding input budget is too small for one Unicode code point",
      );
    }
    if (bytes + pointBytes > maxBytes) {
      windows.push(window);
      window = "";
      bytes = 0;
    }
    window += point;
    bytes += pointBytes;
  }
  if (window.length > 0) windows.push(window);
  return windows;
}

export function assertTexts(texts: readonly string[]): void {
  for (const text of texts) {
    if (typeof text !== "string" || text.length === 0) {
      throw new EmbeddingError("EMPTY_INPUT", "Embedding inputs must be nonempty strings");
    }
  }
}

export async function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
