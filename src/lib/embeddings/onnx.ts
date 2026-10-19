import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import type { EmbeddingConfig, EmbeddingProvider } from "../types.ts";
import {
  assertTexts,
  EmbeddingError,
  fingerprint,
  normalizeVector,
  weightedMean,
} from "./common.ts";
import { resolveModelDirectory } from "./model-cache.ts";

export type OnnxEmbeddingConfig = Extract<EmbeddingConfig, { provider: "onnx" }>;
type Window = { owner: number; text: string; weight: number };

/** Recursive bisection preserves all source characters without relying on a token/character estimate. */
export function splitByTokenBudget(
  text: string,
  prefix: string,
  maxTokens: number,
  countTokens: (text: string) => number,
  signal?: AbortSignal,
): string[] {
  signal?.throwIfAborted();
  if (countTokens(prefix + text) <= maxTokens) return [text];
  const points = Array.from(text);
  if (points.length < 2) {
    throw new EmbeddingError(
      "INPUT_LIMIT",
      "ONNX token budget cannot hold one source code point and the configured prefix",
    );
  }
  const middle = Math.floor(points.length / 2);
  return [
    ...splitByTokenBudget(points.slice(0, middle).join(""), prefix, maxTokens, countTokens, signal),
    ...splitByTokenBudget(points.slice(middle).join(""), prefix, maxTokens, countTokens, signal),
  ];
}

export async function createOnnxEmbeddingProvider(
  config: OnnxEmbeddingConfig,
): Promise<EmbeddingProvider> {
  if (!Number.isSafeInteger(config.dimensions) || config.dimensions < 1)
    throw new RangeError("embeddings.dimensions must be positive");
  if (!Number.isSafeInteger(config.maxTokens) || config.maxTokens < 1)
    throw new RangeError("embeddings.maxTokens must be positive");
  if (!Number.isSafeInteger(config.batchSize) || config.batchSize < 1 || config.batchSize > 256)
    throw new RangeError("ONNX embeddings.batchSize must be between 1 and 256");
  const local = path.isAbsolute(config.model) || config.model.startsWith(".");
  if (!local && !/^[a-f\d]{40}$/i.test(config.revision)) {
    throw new EmbeddingError(
      "MUTABLE_MODEL_REVISION",
      "Remote ONNX models require a full 40-character commit revision so cached vectors have a reproducible model identity",
    );
  }
  const localDigest = local ? await digestModelDirectory(path.resolve(config.model)) : undefined;
  return new OnnxEmbeddingProvider(config, localDigest);
}

class OnnxEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  readonly fingerprint: string;
  private extractor: FeatureExtractionPipeline | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly lifetime = new AbortController();
  private closing: Promise<void> | undefined;

  constructor(
    private readonly config: OnnxEmbeddingConfig,
    private readonly localDigest: string | undefined,
  ) {
    this.dimensions = config.dimensions;
    this.fingerprint = fingerprint({
      version: "object-mcp/onnx/token-bisection-token-weighted-mean/v1",
      transformers: "4.3.1",
      model: config.model,
      revision: localDigest ?? config.revision,
      dimensions: config.dimensions,
      dtype: config.dtype,
      maxTokens: config.maxTokens,
      queryPrefix: config.queryPrefix,
      documentPrefix: config.documentPrefix,
      pooling: "mean",
      normalize: true,
      device: "cpu",
    });
  }

  embed(
    texts: readonly string[],
    purpose: "query" | "document",
    signal?: AbortSignal,
  ): Promise<readonly Float32Array[]> {
    const operation = this.tail.then(() => this.run(texts, purpose, signal));
    this.tail = operation.catch(() => {});
    return operation;
  }

  private async load(signal: AbortSignal): Promise<FeatureExtractionPipeline> {
    signal.throwIfAborted();
    if (this.extractor) return this.extractor;
    await this.verifyLocalModel();
    const directory = await resolveModelDirectory(this.config, signal);
    const { AutoTokenizer, AutoModel, FeatureExtractionPipeline } = await import(
      "@huggingface/transformers"
    );
    signal.throwIfAborted();
    const options = {
      revision: this.config.revision,
      dtype: this.config.dtype,
      device: "cpu" as const,
      cache_dir: this.config.cacheDir,
      local_files_only: true,
      session_options: { logSeverityLevel: 3 as const },
    };
    // v4.3.1 metadata preflight omits revision/offline options; an explicit snapshot path preserves both.
    const tokenizer = await AutoTokenizer.from_pretrained(directory, options);
    signal.throwIfAborted();
    const model = await AutoModel.from_pretrained(directory, options);
    const extractor = new FeatureExtractionPipeline({
      task: "feature-extraction",
      model,
      tokenizer,
    });
    try {
      await this.verifyLocalModel();
      signal.throwIfAborted();
      this.extractor = extractor;
      return extractor;
    } catch (error) {
      await extractor.dispose();
      throw error;
    }
  }

  private async verifyLocalModel(): Promise<void> {
    if (
      this.localDigest !== undefined &&
      (await digestModelDirectory(path.resolve(this.config.model))) !== this.localDigest
    ) {
      throw new EmbeddingError(
        "MODEL_CHANGED",
        "Local ONNX model files changed after provider creation; recreate the framework to obtain a new embedding fingerprint",
      );
    }
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
    const extractor = await this.load(combined);
    const tokenizer = extractor.tokenizer;
    const config = extractor.model.config as unknown as Record<string, unknown>;
    const supportedLimits = [
      this.config.maxTokens,
      tokenizer.model_max_length,
      config.max_position_embeddings,
      config.n_positions,
    ].filter(
      (value): value is number =>
        typeof value === "number" && Number.isSafeInteger(value) && value > 0,
    );
    const limit = Math.min(...supportedLimits);
    const countTokens = (text: string) =>
      tokenizer.encode(text, { add_special_tokens: true }).length;
    const prefix = purpose === "query" ? this.config.queryPrefix : this.config.documentPrefix;
    const windows: Window[] = [];
    for (const [owner, text] of texts.entries()) {
      for (const part of splitByTokenBudget(text, prefix, limit, countTokens, combined)) {
        windows.push({
          owner,
          text: prefix + part,
          weight: Math.max(1, tokenizer.encode(part, { add_special_tokens: false }).length),
        });
      }
    }
    const groups = texts.map(() => ({ vectors: [] as Float32Array[], weights: [] as number[] }));
    for (let offset = 0; offset < windows.length; offset += this.config.batchSize) {
      combined.throwIfAborted();
      const batch = windows.slice(offset, offset + this.config.batchSize);
      // The upstream pipeline enables truncation internally; every input is verified below its real limit.
      if (batch.some((part) => countTokens(part.text) > limit))
        throw new EmbeddingError("INPUT_LIMIT", "ONNX input exceeded the verified tokenizer limit");
      const output = await extractor(
        batch.map((part) => part.text),
        { pooling: "mean", normalize: true },
      );
      try {
        combined.throwIfAborted();
        if (
          output.dims.length !== 2 ||
          output.dims[0] !== batch.length ||
          output.dims[1] !== this.dimensions
        ) {
          throw new EmbeddingError(
            "DIMENSION_MISMATCH",
            `ONNX model returned tensor dimensions ${JSON.stringify(output.dims)}; expected [${batch.length}, ${this.dimensions}]`,
          );
        }
        const values = output.data;
        for (const [row, part] of batch.entries()) {
          const vector = Float32Array.from({ length: this.dimensions }, (_, column) =>
            Number(values[row * this.dimensions + column]),
          );
          const group = groups[part.owner];
          if (!group) throw new EmbeddingError("INVALID_VECTOR", "ONNX window has no source text");
          group.vectors.push(normalizeVector(vector, this.dimensions));
          group.weights.push(part.weight);
        }
      } finally {
        output.dispose();
      }
    }
    combined.throwIfAborted();
    return groups.map(({ vectors, weights }) => weightedMean(vectors, weights, this.dimensions));
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.lifetime.abort(new DOMException("Embedding provider closed", "AbortError"));
    this.closing = this.tail.then(async () => {
      await this.extractor?.dispose();
      this.extractor = undefined;
    });
    return this.closing;
  }
}

/** Hash local weights and tokenizer/config content, not just a mutable directory name. */
async function digestModelDirectory(directory: string): Promise<string> {
  const hash = createHash("sha256");
  let files = 0;
  async function visit(relative: string): Promise<void> {
    const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        await visit(child);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        const full = path.join(directory, child);
        const info = await stat(full);
        if (!info.isFile())
          throw new EmbeddingError(
            "MODEL_FILES",
            "Local model directory links must point to regular files",
          );
        hash.update(JSON.stringify({ file: child.split(path.sep).join("/"), size: info.size }));
        for await (const chunk of createReadStream(full)) hash.update(chunk as Buffer);
        files++;
      }
    }
  }
  try {
    await visit("");
  } catch (error) {
    if (error instanceof EmbeddingError) throw error;
    throw new EmbeddingError("MODEL_FILES", `Cannot read local ONNX model directory ${directory}`, {
      cause: error,
    });
  }
  if (files === 0) throw new EmbeddingError("MODEL_FILES", "Local ONNX model directory is empty");
  return hash.digest("hex");
}
