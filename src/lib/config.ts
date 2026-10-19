import { readFile } from "node:fs/promises";
import path from "node:path";
import { Schema } from "effect";
import { FrameworkError } from "./errors.ts";
import { DEFAULT_REPAIR_OPTIONS } from "./json-repair/types.ts";
import type { EmbeddingConfig, FrameworkConfig } from "./types.ts";

const positive = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);
const nonnegative = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
);
const fraction = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 0.9 }));
const weight = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 100 }));
const text = Schema.NonEmptyString;

export const McpInputRepairConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  syntax: Schema.Boolean,
  fuzzyKeys: Schema.Boolean,
  coerceTypes: Schema.Boolean,
  inferWrappers: Schema.Boolean,
  splitArrays: Schema.Boolean,
  maxKeyDistance: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 })),
  minConfidence: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  maxDepth: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 128 })),
  maxNodes: positive,
  maxInputBytes: positive,
  maxRepairs: positive,
});

const OnnxConfig = Schema.Struct({
  provider: Schema.Literal("onnx"),
  model: text,
  revision: text,
  dimensions: positive,
  dtype: Schema.Literals(["q8", "fp32", "fp16", "q4"]),
  cacheDir: text,
  localFilesOnly: Schema.Boolean,
  queryPrefix: Schema.String,
  documentPrefix: Schema.String,
  maxTokens: positive,
  batchSize: positive,
});
const OpenAIConfig = Schema.Struct({
  provider: Schema.Literal("openai"),
  model: text,
  dimensions: positive,
  baseUrl: text,
  apiKeyEnv: text,
  batchSize: positive,
  timeoutMs: positive,
  retries: nonnegative,
  maxInputBytes: positive,
  queryPrefix: Schema.String,
  documentPrefix: Schema.String,
});
export const FrameworkConfigSchema = Schema.Struct({
  root: text,
  sqlite: Schema.Struct({
    path: text,
    driver: Schema.Literals(["better-sqlite3", "bun"]),
    busyTimeoutMs: nonnegative,
    extensionPath: Schema.optionalKey(text),
    customSQLite: Schema.optionalKey(text),
  }),
  embeddings: Schema.Union([
    Schema.Struct({ provider: Schema.Literal("disabled") }),
    OnnxConfig,
    OpenAIConfig,
  ]),
  chunking: Schema.Struct({ size: positive, overlap: fraction }),
  sync: Schema.Struct({
    watch: Schema.Boolean,
    confinement: Schema.Literals(["auto", "descriptor", "portable"]),
    debounceMs: nonnegative,
    rescanIntervalMs: nonnegative,
    maxFileBytes: positive,
    concurrency: positive,
    lockTimeoutMs: positive,
  }),
  search: Schema.Struct({
    defaultTopN: positive,
    maxTopN: positive,
    candidateMultiplier: positive,
    rrfK: positive,
    fulltextWeight: weight,
    semanticWeight: weight,
    maxMatchCharacters: positive,
  }),
  server: Schema.Struct({ name: text, version: text }),
  mcp: Schema.Struct({ inputRepair: McpInputRepairConfigSchema }),
});

const onnxDefaults: Extract<EmbeddingConfig, { provider: "onnx" }> = {
  provider: "onnx",
  model: "Xenova/multilingual-e5-small",
  revision: "761b726dd34fb83930e26aab4e9ac3899aa1fa78",
  dimensions: 384,
  dtype: "q8",
  cacheDir: ".object-mcp/models",
  localFilesOnly: true,
  queryPrefix: "query: ",
  documentPrefix: "passage: ",
  maxTokens: 512,
  batchSize: 8,
};
const openaiDefaults: Extract<EmbeddingConfig, { provider: "openai" }> = {
  provider: "openai",
  model: "text-embedding-3-small",
  dimensions: 1536,
  baseUrl: "https://api.openai.com/v1",
  apiKeyEnv: "OPENAI_API_KEY",
  batchSize: 32,
  timeoutMs: 30_000,
  retries: 3,
  maxInputBytes: 8000,
  queryPrefix: "",
  documentPrefix: "",
};

export const defaultConfig: FrameworkConfig = {
  root: "objects",
  sqlite: { path: ".object-mcp/index.sqlite", driver: "better-sqlite3", busyTimeoutMs: 5000 },
  embeddings: onnxDefaults,
  chunking: { size: 1200, overlap: 0.1 },
  sync: {
    watch: true,
    confinement: "auto",
    debounceMs: 150,
    rescanIntervalMs: 60_000,
    maxFileBytes: 5_000_000,
    concurrency: 2,
    lockTimeoutMs: 10_000,
  },
  search: {
    defaultTopN: 10,
    maxTopN: 100,
    candidateMultiplier: 5,
    rrfK: 60,
    fulltextWeight: 1,
    semanticWeight: 1,
    maxMatchCharacters: 1200,
  },
  server: { name: "object-mcp", version: "0.1.0" },
  mcp: {
    inputRepair: { ...DEFAULT_REPAIR_OPTIONS },
  },
};

export type FrameworkConfigInput = {
  readonly root?: string;
  readonly sqlite?: Partial<FrameworkConfig["sqlite"]>;
  readonly embeddings?:
    | { readonly provider: "disabled" }
    | ({ readonly provider: "onnx" } & Partial<Extract<EmbeddingConfig, { provider: "onnx" }>>)
    | ({ readonly provider: "openai" } & Partial<Extract<EmbeddingConfig, { provider: "openai" }>>);
  readonly chunking?: Partial<FrameworkConfig["chunking"]>;
  readonly sync?: Partial<FrameworkConfig["sync"]>;
  readonly search?: Partial<FrameworkConfig["search"]>;
  readonly server?: Partial<FrameworkConfig["server"]>;
  readonly mcp?: { readonly inputRepair?: Partial<FrameworkConfig["mcp"]["inputRepair"]> };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function defineConfig(
  input: FrameworkConfigInput = {},
  baseDirectory = process.cwd(),
): FrameworkConfig {
  if (!isRecord(input)) throw new FrameworkError("CONFIG", "Configuration must be an object.");
  const raw = input as Record<string, unknown>;
  const knownKeys = new Set(Object.keys(defaultConfig));
  for (const key of Object.keys(raw))
    if (!knownKeys.has(key))
      throw new FrameworkError("CONFIG", `Unknown configuration key: ${key}`);
  for (const key of ["sqlite", "embeddings", "chunking", "sync", "search", "server", "mcp"]) {
    if (Object.hasOwn(raw, key) && !isRecord(raw[key]))
      throw new FrameworkError("CONFIG", `${key} configuration must be an object.`);
  }
  if (input.mcp && Object.hasOwn(input.mcp, "inputRepair") && !isRecord(input.mcp.inputRepair)) {
    throw new FrameworkError("CONFIG", "mcp.inputRepair configuration must be an object.");
  }
  const embeddingInput = input.embeddings;
  const providerDefaults =
    embeddingInput?.provider === "openai"
      ? openaiDefaults
      : embeddingInput?.provider === "disabled"
        ? { provider: "disabled" as const }
        : onnxDefaults;
  const merged = {
    ...defaultConfig,
    ...input,
    sqlite: { ...defaultConfig.sqlite, ...input.sqlite },
    embeddings: { ...providerDefaults, ...embeddingInput },
    chunking: { ...defaultConfig.chunking, ...input.chunking },
    sync: { ...defaultConfig.sync, ...input.sync },
    search: { ...defaultConfig.search, ...input.search },
    server: { ...defaultConfig.server, ...input.server },
    mcp: {
      ...defaultConfig.mcp,
      ...input.mcp,
      inputRepair: { ...defaultConfig.mcp.inputRepair, ...input.mcp?.inputRepair },
    },
  };
  let config: FrameworkConfig;
  try {
    config = Schema.decodeUnknownSync(FrameworkConfigSchema, { onExcessProperty: "error" })(merged);
  } catch (error) {
    throw new FrameworkError(
      "CONFIG",
      `Invalid configuration: ${String(error)}`,
      {},
      { cause: error },
    );
  }
  if (config.search.defaultTopN > config.search.maxTopN)
    throw new FrameworkError("CONFIG", "search.defaultTopN must not exceed search.maxTopN.");
  if (config.search.fulltextWeight + config.search.semanticWeight === 0)
    throw new FrameworkError("CONFIG", "At least one search weight must be positive.");
  if (config.chunking.size * (1 - config.chunking.overlap) < 1)
    throw new FrameworkError(
      "CONFIG",
      "Chunk overlap must leave at least one new codepoint per chunk.",
    );
  const resolvedRoot = path.resolve(baseDirectory, config.root);
  const resolvedDb =
    config.sqlite.path === ":memory:"
      ? ":memory:"
      : path.resolve(baseDirectory, config.sqlite.path);
  const isInside = (parent: string, child: string) =>
    child === parent || child.startsWith(parent + path.sep);
  for (const definition of [resolvedDb]) {
    if (isInside(resolvedRoot, definition))
      throw new FrameworkError(
        "CONFIG",
        "The SQLite cache must be outside the authoritative object directory.",
      );
  }
  let embeddings = config.embeddings;
  if (embeddings.provider === "onnx") {
    embeddings = {
      ...embeddings,
      cacheDir: path.resolve(baseDirectory, embeddings.cacheDir),
      model:
        embeddings.model.startsWith(".") || path.isAbsolute(embeddings.model)
          ? path.resolve(baseDirectory, embeddings.model)
          : embeddings.model,
    };
    if (isInside(resolvedRoot, embeddings.cacheDir))
      throw new FrameworkError("CONFIG", "The model cache must be outside the object directory.");
  }
  if (embeddings.provider === "openai") {
    const url = new URL(embeddings.baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new FrameworkError(
        "CONFIG",
        "Embedding baseUrl must be an HTTP(S) URL without credentials, query, or fragment.",
      );
    }
  }
  return {
    ...config,
    root: resolvedRoot,
    sqlite: {
      ...config.sqlite,
      path: resolvedDb,
      ...(config.sqlite.extensionPath
        ? { extensionPath: path.resolve(baseDirectory, config.sqlite.extensionPath) }
        : {}),
      ...(config.sqlite.customSQLite
        ? { customSQLite: path.resolve(baseDirectory, config.sqlite.customSQLite) }
        : {}),
    },
    embeddings,
  };
}

export async function loadConfig(filename: string): Promise<FrameworkConfig> {
  const absolute = path.resolve(filename);
  let input: unknown;
  try {
    input = JSON.parse(await readFile(absolute, "utf8"));
  } catch (error) {
    throw new FrameworkError(
      "CONFIG",
      `Cannot load JSON configuration ${absolute}: ${String(error)}`,
      {},
      { cause: error },
    );
  }
  return defineConfig(input as FrameworkConfigInput, path.dirname(absolute));
}
