import type { Schema } from "effect";
import type { DocumentIssue, JsonRecord } from "./vault/read-data.ts";

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

/**
 * The relation kinds. The kind decides how a change propagates along a relation, which is
 * what separates a dependency that breaks from a justification that goes stale.
 */
export type RelationKind = "depends" | "uses" | "justifies" | "contains" | "owns" | "relates";

export interface RelationDescriptor {
  /** The path inside the object's `relations` struct, for example "commitsTo" or "commitment.scenarios". */
  readonly path: string;
  readonly kind: RelationKind;
  /** The registered type the field declares its targets to be. */
  readonly targetType: string;
  readonly cardinality: "one" | "many";
}

export interface ObjectDefinition<A extends BaseObject = BaseObject> {
  readonly name: string;
  readonly directory: string;
  readonly description: string;
  // biome-ignore lint/suspicious/noExplicitAny: Registry entries erase each Effect codec's encoded type while retaining its domain type and runtime validation.
  readonly schema: Schema.Codec<A, any, never, never>;
  /** The relation fields this type declares, with the kind that decides impact propagation. */
  readonly relations?: readonly RelationDescriptor[];
}

export interface StoredObject<A extends BaseObject = BaseObject> {
  readonly partial?: false;
  readonly type: string;
  readonly object: A;
  readonly body: string;
  readonly path: string;
  readonly checksum: string;
}

export interface DocumentIdentity {
  readonly source: "filename" | "frontmatter";
  readonly id: string;
  readonly type: string;
}

export interface PartialStoredObject {
  readonly partial: true;
  readonly type: string;
  readonly object: JsonRecord & { readonly id: string };
  readonly body: string;
  readonly path: string;
  readonly checksum: string;
  readonly raw: string;
  readonly issues: readonly DocumentIssue[];
  readonly identity: DocumentIdentity;
}

export type ReadObject = StoredObject | PartialStoredObject;

export interface PartialSourceDocument extends PartialStoredObject {
  readonly json: JsonRecord;
  readonly key: string;
}

export type ReadDocument = SourceDocument | PartialSourceDocument;

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
  /** Ensures the provider can serve embeddings, fetching a missing snapshot when it may. */
  prepare?(signal?: AbortSignal): Promise<void>;
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

/** Ranked index evidence whose current source validity has not yet been established. */
export interface SearchCandidate {
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

export interface CompleteSearchHit extends SearchCandidate {
  readonly partial?: false;
  readonly object?: never;
  readonly identity?: never;
  readonly issues?: never;
}

export interface PartialSearchHit extends SearchCandidate {
  readonly partial: true;
  readonly object: PartialStoredObject["object"];
  readonly identity: DocumentIdentity;
  readonly issues: readonly DocumentIssue[];
}

export type SearchHit = CompleteSearchHit | PartialSearchHit;

export interface SearchResponse {
  readonly mode: SearchMode;
  readonly hits: readonly SearchHit[];
  readonly indexGeneration: number;
}

export interface SearchCandidateResponse extends Omit<SearchResponse, "hits"> {
  readonly hits: readonly SearchCandidate[];
}

/** The largest number of hops one relation query may walk. */
export const RELATIONS_DEPTH_MAX = 10;

/** The number of edges one relation query may return before it summarizes the rest. */
export const RELATIONS_EDGE_LIMIT = 1000;

export type RelationsMode = "neighbors" | "impact";

export type RelationsDirection = "incoming" | "outgoing" | "both";

/** The kinds that propagate a change by default; the organizational kinds are opt-in. */
export const RELATIONS_IMPACT_KINDS: readonly RelationKind[] = ["depends", "uses", "justifies"];

export interface RelationsRequest {
  readonly type: string;
  readonly id: string;
  readonly mode?: RelationsMode;
  /** Which way the walk follows the stored edges. It applies to the neighbors mode only. */
  readonly direction?: RelationsDirection;
  readonly edgeKinds?: readonly RelationKind[];
  readonly depth?: number;
  /** Restricts which related types are reported. The traversal still passes through them. */
  readonly types?: readonly string[];
  readonly includeRetired?: boolean;
}

export interface RelationNode {
  readonly type: string;
  readonly id: string;
  readonly name: string;
  readonly title: string;
}

export interface RelationEdge {
  /** The direction of the walk that first reached the edge, which is the one nearest the root. */
  readonly direction: "incoming" | "outgoing";
  readonly kind: RelationKind;
  /** The relation field the edge was read from, for example "relations.commitsTo". */
  readonly field: string;
  readonly from: RelationNode;
  readonly to: RelationNode;
  /** The hops from the root to the edge's far endpoint. */
  readonly distance: number;
  /** The endpoint a change to the other endpoint propagates to. Null when the kind carries no impact. */
  readonly affects: "from" | "to" | null;
}

export interface AffectedObject {
  readonly type: string;
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly distance: number;
  readonly kind: RelationKind;
  /** The nodes walked to reach this one, starting at the root. */
  readonly via: readonly RelationNode[];
}

export interface RelationFinding {
  readonly code: string;
  readonly message: string;
  readonly edge?: {
    readonly kind: RelationKind;
    readonly field: string;
    readonly from: RelationNode;
    readonly to: RelationNode;
  };
  readonly node?: RelationNode;
}

export interface RelationsResponse {
  /** Present when recoverable source warnings prevent claiming a complete graph. */
  readonly complete?: false;
  readonly issues?: readonly SyncIssue[];
  readonly root: RelationNode;
  readonly mode: RelationsMode;
  readonly edges: readonly RelationEdge[];
  readonly affected: readonly AffectedObject[];
  readonly findings: readonly RelationFinding[];
  readonly totalEdges: number;
  readonly truncated: boolean;
  readonly findingsTotal: number;
  readonly findingsTruncated: boolean;
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
  get(type: string, id: string, signal?: AbortSignal): Promise<ReadObject>;
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
  ): Promise<{ objects: readonly ReadObject[]; total: number }>;
  search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResponse>;
  relations(request: RelationsRequest, signal?: AbortSignal): Promise<RelationsResponse>;
  resync(signal?: AbortSignal): Promise<SyncReport>;
  status(): Record<string, unknown>;
  close(): Promise<void>;
}
