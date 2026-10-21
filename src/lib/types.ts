import type { Schema } from "effect";

/** The largest number of objects one list call may return. */
export const LIST_LIMIT_MAX = 1000;

/** The number of objects one list call returns when the caller sets no limit. */
export const LIST_LIMIT_DEFAULT = 50;

/** The number of synchronization issues the status report lists before it summarizes the rest. */
export const STATUS_ISSUE_LIMIT = 50;

export interface BaseObject {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly retiredAt: Date | null;
  readonly tags: Readonly<Record<string, string>>;
  // biome-ignore lint/suspicious/noExplicitAny: The supplied domain contract intentionally permits arbitrary metadata; persistence validates JSON compatibility separately.
  readonly metadata: Readonly<Record<string, any>>;
}

export interface ObjectDefinition<A extends BaseObject = BaseObject> {
  readonly name: string;
  readonly directory: string;
  readonly description: string;
  // biome-ignore lint/suspicious/noExplicitAny: Registry entries erase each Effect codec's encoded type while retaining its domain type and runtime validation.
  readonly schema: Schema.Codec<A, any, never, never>;
}

export interface StoredObject<A extends BaseObject = BaseObject> {
  readonly type: string;
  readonly object: A;
  readonly body: string;
  readonly path: string;
  readonly checksum: string;
}

export interface SourceDocument extends StoredObject {
  readonly key: string;
  readonly raw: string;
  readonly json: Record<string, unknown>;
}

export interface TextChunk {
  readonly index: number;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export interface EmbeddedChunk extends TextChunk {
  readonly vector: Float32Array;
}

export interface EmbeddingProvider {
  readonly dimensions: number;
  readonly fingerprint: string;
  embed(
    texts: readonly string[],
    purpose: "query" | "document",
    signal?: AbortSignal,
  ): Promise<readonly Float32Array[]>;
  close(): Promise<void>;
}

export interface ChunkingConfig {
  readonly size: number;
  readonly overlap: number;
}

export type EmbeddingConfig =
  | { readonly provider: "disabled" }
  | {
      readonly provider: "onnx";
      readonly model: string;
      readonly revision: string;
      readonly dimensions: number;
      readonly dtype: "q8" | "fp32" | "fp16" | "q4";
      readonly device: "cpu" | "cuda";
      readonly cacheDir: string;
      readonly localFilesOnly: boolean;
      readonly queryPrefix: string;
      readonly documentPrefix: string;
      readonly maxTokens: number;
      readonly batchSize: number;
    }
  | {
      readonly provider: "openai";
      readonly model: string;
      readonly dimensions: number;
      readonly baseUrl: string;
      readonly apiKeyEnv: string;
      // A literal key overrides the environment variable; it never enters a fingerprint or an error message.
      readonly apiKey?: string;
      readonly batchSize: number;
      readonly timeoutMs: number;
      readonly retries: number;
      readonly maxInputBytes: number;
      readonly queryPrefix: string;
      readonly documentPrefix: string;
    };

export interface McpInputRepairConfig {
  readonly enabled: boolean;
  readonly syntax: boolean;
  readonly fuzzyKeys: boolean;
  readonly coerceTypes: boolean;
  readonly inferWrappers: boolean;
  readonly splitArrays: boolean;
  readonly maxKeyDistance: number;
  readonly minConfidence: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxInputBytes: number;
  readonly maxRepairs: number;
}

export interface McpConfig {
  readonly inputRepair: McpInputRepairConfig;
}

export interface FrameworkConfig {
  readonly root: string;
  readonly sqlite: {
    readonly path: string;
    readonly driver: "better-sqlite3" | "bun";
    readonly busyTimeoutMs: number;
    readonly extensionPath?: string;
    readonly customSQLite?: string;
  };
  readonly embeddings: EmbeddingConfig;
  readonly chunking: ChunkingConfig;
  readonly sync: {
    readonly watch: boolean;
    readonly confinement: "auto" | "descriptor" | "portable";
    readonly debounceMs: number;
    readonly rescanIntervalMs: number;
    readonly maxFileBytes: number;
    readonly concurrency: number;
    readonly lockTimeoutMs: number;
  };
  readonly search: {
    readonly defaultTopN: number;
    readonly maxTopN: number;
    readonly candidateMultiplier: number;
    readonly rrfK: number;
    readonly fulltextWeight: number;
    readonly semanticWeight: number;
    readonly maxMatchCharacters: number;
  };
  readonly server: { readonly name: string; readonly version: string };
  readonly mcp: McpConfig;
}

export type SearchMode = "fulltext" | "semantic" | "hybrid";

export interface SearchRequest {
  readonly query: string;
  readonly mode?: SearchMode;
  readonly types?: readonly string[];
  readonly topN?: number;
  readonly includeBody?: boolean;
}

export interface SearchHit {
  readonly type: string;
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly path: string;
  readonly checksum: string;
  readonly score: number;
  readonly fulltextRank: number | null;
  /** Bounded lexical evidence without coordinates; older/custom producers may omit it. */
  readonly fulltextExcerpt?: string | null;
  readonly semanticDistance: number | null;
  readonly matchedChunk: {
    readonly index: number;
    readonly start: number;
    readonly end: number;
    readonly text: string;
  } | null;
  readonly body?: string;
}

export interface SearchResponse {
  readonly mode: SearchMode;
  readonly hits: readonly SearchHit[];
  readonly indexGeneration: number;
}

export interface SyncIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface SyncReport {
  readonly scanned: number;
  readonly indexed: number;
  readonly unchanged: number;
  readonly deleted: number;
  readonly issues: readonly SyncIssue[];
  readonly generation: number;
}

export interface ObjectFacade {
  readonly definitions: readonly ObjectDefinition[];
  // The search bounds are advertised to clients, so a facade that knows them must expose them.
  readonly config?: Pick<FrameworkConfig, "mcp"> & Partial<Pick<FrameworkConfig, "search">>;
  create(type: string, object: unknown, body?: string, signal?: AbortSignal): Promise<StoredObject>;
  get(type: string, id: string, signal?: AbortSignal): Promise<StoredObject>;
  update(
    type: string,
    id: string,
    object: unknown,
    body: string,
    expectedChecksum: string,
    signal?: AbortSignal,
  ): Promise<StoredObject>;
  delete(
    type: string,
    id: string,
    expectedChecksum: string,
    signal?: AbortSignal,
  ): Promise<{ type: string; id: string; deleted: true }>;
  list(
    type: string,
    options?: { limit?: number; offset?: number },
    signal?: AbortSignal,
  ): Promise<{ objects: readonly StoredObject[]; total: number }>;
  search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResponse>;
  resync(signal?: AbortSignal): Promise<SyncReport>;
  status(): Record<string, unknown>;
  close(): Promise<void>;
}
