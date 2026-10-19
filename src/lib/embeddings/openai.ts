import type { EmbeddingConfig, EmbeddingProvider } from "../types.ts";
import {
  assertTexts,
  delay,
  EmbeddingError,
  fingerprint,
  normalizeVector,
  splitUtf8,
  weightedMean,
} from "./common.ts";

export type OpenAIEmbeddingConfig = Extract<EmbeddingConfig, { provider: "openai" }>;
export type EmbeddingFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface OpenAIProviderDependencies {
  readonly fetch?: EmbeddingFetch;
  readonly apiKey?: () => string | undefined;
}

type InputWindow = { owner: number; text: string; weight: number };

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  readonly fingerprint: string;
  private readonly fetcher: EmbeddingFetch;
  private readonly apiKey: () => string | undefined;
  private readonly lifetime = new AbortController();
  private readonly active = new Set<Promise<unknown>>();

  constructor(
    private readonly config: OpenAIEmbeddingConfig,
    dependencies: OpenAIProviderDependencies = {},
  ) {
    if (!Number.isSafeInteger(config.dimensions) || config.dimensions < 1)
      throw new RangeError("embeddings.dimensions must be positive");
    if (
      !Number.isSafeInteger(config.batchSize) ||
      config.batchSize < 1 ||
      config.batchSize > 2048
    ) {
      throw new RangeError("OpenAI embeddings.batchSize must be between 1 and 2048");
    }
    if (
      !Number.isSafeInteger(config.maxInputBytes) ||
      config.maxInputBytes < 4 ||
      config.maxInputBytes > 8191
    ) {
      throw new RangeError("OpenAI embeddings.maxInputBytes must be between 4 and 8191");
    }
    if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1)
      throw new RangeError("embeddings.timeoutMs must be positive");
    if (!Number.isSafeInteger(config.retries) || config.retries < 0 || config.retries > 10)
      throw new RangeError("embeddings.retries must be between 0 and 10");
    const endpoint = new URL(`${config.baseUrl.replace(/\/+$/, "")}/embeddings`);
    if (
      !["https:", "http:"].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password
    ) {
      throw new RangeError(
        "OpenAI embeddings.baseUrl must be an HTTP(S) URL without embedded credentials",
      );
    }
    this.dimensions = config.dimensions;
    this.fetcher = dependencies.fetch ?? globalThis.fetch;
    this.apiKey = dependencies.apiKey ?? (() => process.env[config.apiKeyEnv]);
    this.fingerprint = fingerprint({
      version: "object-mcp/openai/utf8-weighted-mean/v1",
      model: config.model,
      dimensions: config.dimensions,
      endpoint: endpoint.toString(),
      maxInputBytes: config.maxInputBytes,
      queryPrefix: config.queryPrefix,
      documentPrefix: config.documentPrefix,
    });
  }

  embed(
    texts: readonly string[],
    purpose: "query" | "document",
    signal?: AbortSignal,
  ): Promise<readonly Float32Array[]> {
    const operation = this.run(texts, purpose, signal);
    this.active.add(operation);
    void operation.finally(() => this.active.delete(operation)).catch(() => {});
    return operation;
  }

  private async run(
    texts: readonly string[],
    purpose: "query" | "document",
    signal?: AbortSignal,
  ): Promise<readonly Float32Array[]> {
    const combined = signal
      ? AbortSignal.any([signal, this.lifetime.signal])
      : this.lifetime.signal;
    combined.throwIfAborted();
    assertTexts(texts);
    if (texts.length === 0) return [];
    const key = this.apiKey();
    if (!key)
      throw new EmbeddingError(
        "API_KEY_MISSING",
        `Set the ${this.config.apiKeyEnv} environment variable for OpenAI embeddings`,
      );
    const prefix = purpose === "query" ? this.config.queryPrefix : this.config.documentPrefix;
    const budget = this.config.maxInputBytes - Buffer.byteLength(prefix, "utf8");
    if (budget < 4)
      throw new EmbeddingError("INPUT_LIMIT", "Embedding prefix leaves insufficient input budget");
    const windows: InputWindow[] = [];
    for (const [owner, text] of texts.entries()) {
      for (const part of splitUtf8(text, budget)) {
        windows.push({
          owner,
          text: prefix + part,
          weight: Math.max(1, Buffer.byteLength(part, "utf8")),
        });
      }
    }
    const groups = texts.map(() => ({ vectors: [] as Float32Array[], weights: [] as number[] }));
    let offset = 0;
    while (offset < windows.length) {
      combined.throwIfAborted();
      const batch: InputWindow[] = [];
      let requestBytes = 0;
      while (offset < windows.length && batch.length < this.config.batchSize) {
        const next = windows[offset];
        if (!next) throw new EmbeddingError("INVALID_VECTOR", "Embedding window is missing");
        const bytes = Buffer.byteLength(next.text, "utf8");
        // UTF-8 byte count upper-bounds byte-level BPE token count, including multilingual text.
        if (batch.length > 0 && requestBytes + bytes > 256_000) break;
        batch.push(next);
        requestBytes += bytes;
        offset++;
      }
      const vectors = await this.request(
        batch.map((part) => part.text),
        key,
        combined,
      );
      batch.forEach((part, index) => {
        const group = groups[part.owner];
        const vector = vectors[index];
        if (!group || !vector)
          throw new EmbeddingError(
            "INVALID_VECTOR",
            "Embedding response is missing a source vector",
          );
        group.vectors.push(vector);
        group.weights.push(part.weight);
      });
    }
    combined.throwIfAborted();
    return groups.map(({ vectors, weights }) => weightedMean(vectors, weights, this.dimensions));
  }

  private async request(
    inputs: readonly string[],
    key: string,
    signal: AbortSignal,
  ): Promise<readonly Float32Array[]> {
    const endpoint = `${this.config.baseUrl.replace(/\/+$/, "")}/embeddings`;
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      const requestController = new AbortController();
      const timeout = setTimeout(
        () =>
          requestController.abort(new DOMException("Embedding request timed out", "TimeoutError")),
        this.config.timeoutMs,
      );
      const requestSignal = AbortSignal.any([signal, requestController.signal]);
      let retryDelay: number | undefined;
      try {
        const response = await this.fetcher(endpoint, {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({
            model: this.config.model,
            input: inputs,
            encoding_format: "float",
            ...(this.config.model.startsWith("text-embedding-ada-")
              ? {}
              : { dimensions: this.dimensions }),
          }),
          signal: requestSignal,
          redirect: "error",
        });
        if (!response.ok) {
          const transient =
            response.status === 408 ||
            response.status === 409 ||
            response.status === 429 ||
            response.status >= 500;
          if (!transient || attempt >= this.config.retries) {
            await response.body?.cancel();
            throw new EmbeddingError(
              "HTTP_ERROR",
              `Embedding endpoint returned HTTP ${response.status}`,
            );
          }
          retryDelay = retryAfter(response.headers.get("retry-after"), attempt);
          await response.body?.cancel();
        } else {
          const json: unknown = await response.json();
          signal.throwIfAborted();
          return parseResponse(json, inputs.length, this.dimensions);
        }
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof EmbeddingError || attempt >= this.config.retries) {
          if (error instanceof EmbeddingError) throw error;
          throw new EmbeddingError(
            "REQUEST_FAILED",
            "Embedding endpoint request failed or timed out",
            { cause: error },
          );
        }
        retryDelay = retryAfter(null, attempt);
      } finally {
        clearTimeout(timeout);
      }
      await delay(retryDelay ?? retryAfter(null, attempt), signal);
    }
  }

  async close(): Promise<void> {
    this.lifetime.abort(new DOMException("Embedding provider closed", "AbortError"));
    await Promise.allSettled([...this.active]);
  }
}

function retryAfter(header: string | null, attempt: number): number {
  const fallback = Math.min(10_000, 200 * 2 ** attempt);
  if (header === null) return fallback;
  const seconds = Number(header);
  const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(milliseconds) ? Math.max(0, Math.min(30_000, milliseconds)) : fallback;
}

function parseResponse(
  value: unknown,
  expected: number,
  dimensions: number,
): readonly Float32Array[] {
  if (!value || typeof value !== "object" || !("data" in value) || !Array.isArray(value.data)) {
    throw new EmbeddingError("INVALID_RESPONSE", "Embedding endpoint did not return a data array");
  }
  const vectors: Array<Float32Array | undefined> = new Array(expected);
  if (value.data.length !== expected)
    throw new EmbeddingError(
      "INVALID_RESPONSE",
      "Embedding endpoint returned an incorrect vector count",
    );
  for (const item of value.data) {
    if (
      !item ||
      typeof item !== "object" ||
      !Number.isSafeInteger(item.index) ||
      item.index < 0 ||
      item.index >= expected ||
      vectors[item.index] !== undefined
    ) {
      throw new EmbeddingError(
        "INVALID_RESPONSE",
        "Embedding endpoint returned invalid or duplicate input indices",
      );
    }
    if (
      !Array.isArray(item.embedding) ||
      !item.embedding.every((component: unknown) => typeof component === "number")
    ) {
      throw new EmbeddingError(
        "INVALID_RESPONSE",
        "Embedding endpoint returned a nonnumeric embedding",
      );
    }
    vectors[item.index] = normalizeVector(item.embedding, dimensions);
  }
  if (vectors.some((vector) => vector === undefined))
    throw new EmbeddingError("INVALID_RESPONSE", "Embedding endpoint omitted an input index");
  return vectors as Float32Array[];
}
