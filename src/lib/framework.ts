import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Cause, Effect, Exit, Layer, ManagedRuntime, Semaphore } from "effect";
import { chunkText, embedChunks, embeddingFingerprint } from "./chunking.ts";
import { defineConfig, type FrameworkConfigInput } from "./config.ts";
import { createEmbeddingProvider } from "./embeddings/index.ts";
import { asFrameworkError, FrameworkError } from "./errors.ts";
import { checksum, FileStore, objectKey } from "./filesystem.ts";
import { documentLabels } from "./read-document.ts";
import { ObjectRegistry } from "./registry.ts";
import { buildRelationGraph, nodeKey, type RelationTraversal } from "./relation-graph.ts";
import { affectedObjects, relationFindings, walkGraph } from "./relations.ts";
import { SqliteIndex } from "./sqlite/index.ts";
import {
  type EmbeddingProvider,
  type FrameworkConfig,
  LIST_LIMIT_DEFAULT,
  LIST_LIMIT_MAX,
  type ObjectDefinition,
  type ObjectFacade,
  type ObjectListResult,
  RELATIONS_DEPTH_MAX,
  RELATIONS_EDGE_LIMIT,
  RELATIONS_IMPACT_KINDS,
  type ReadDocument,
  type ReadObject,
  type RelationEdge,
  type RelationKind,
  type RelationNode,
  type RelationsRequest,
  type RelationsResponse,
  type SearchHit,
  type SearchRequest,
  type SearchResponse,
  type SourceDocument,
  STATUS_ISSUE_LIMIT,
  type StoredObject,
  type SyncIssue,
  type SyncReport,
} from "./types.ts";
import { reconcileSnapshot } from "./vault/reconciliation.ts";
import { WatchLifecycle } from "./vault/watch-lifecycle.ts";
import { FileWatcher } from "./vault/watcher.ts";

/** Every relation kind, in the order the tool lists them. */
const RELATION_KINDS: readonly RelationKind[] = [
  "depends",
  "uses",
  "justifies",
  "contains",
  "owns",
  "relates",
];

/** The number of findings one relation response carries before it summarizes the rest. */
const RELATION_FINDING_LIMIT = 100;

export type FrameworkEvent =
  | {
      readonly kind: "object_created" | "object_updated" | "object_deleted";
      readonly source: "tool";
      readonly type: string;
      readonly id: string;
    }
  | { readonly kind: "source_changed"; readonly source: "filesystem"; readonly path: string }
  | { readonly kind: "sync_completed"; readonly source: "filesystem"; readonly report: SyncReport };

interface FrameworkOptions {
  readonly config?: FrameworkConfigInput;
  readonly baseDirectory?: string;
  readonly embeddingProvider?: EmbeddingProvider;
  readonly reconciliation?: "maintenance" | "projection";
  /** Wait for startup reconciliation before returning. Defaults to true. */
  readonly waitForStartup?: boolean;
  readonly onError?: (error: FrameworkError) => void;
}

export type CreateFrameworkOptions = FrameworkOptions &
  (
    | { readonly registry: ObjectRegistry; readonly definitions?: never }
    | { readonly definitions: readonly ObjectDefinition[]; readonly registry?: never }
  );

function publicObject(document: SourceDocument): StoredObject;
function publicObject(document: ReadDocument): ReadObject;
function publicObject(document: ReadDocument): ReadObject {
  const common = {
    type: document.type,
    body: document.body,
    path: document.path,
    checksum: document.checksum,
  };
  if (document.partial)
    return {
      ...common,
      partial: true,
      object: document.object,
      raw: document.raw,
      issues: document.issues,
      identity: document.identity,
    };
  return { ...common, object: document.object };
}

function lowercaseRelations(value: unknown): unknown {
  if (typeof value === "string") return value.toLowerCase();
  if (Array.isArray(value)) return value.map(lowercaseRelations);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, lowercaseRelations(child)]),
    );
  return value;
}

function normalizeIdentifiers(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  return {
    ...value,
    ...("id" in value && typeof value.id === "string" ? { id: value.id.toLowerCase() } : {}),
    ...("relations" in value ? { relations: lowercaseRelations(value.relations) } : {}),
  };
}

/**
 * The status report lists a bounded number of issues, so the totals and the per-code
 * counts describe what the bound left out.
 */
function summarizeIssues(issues: readonly SyncIssue[]): {
  readonly issues: readonly SyncIssue[];
  readonly issuesTotal: number;
  readonly issuesTruncated: boolean;
  readonly issuesByCode: Record<string, number>;
} {
  const issuesByCode: Record<string, number> = {};
  for (const issue of issues) issuesByCode[issue.code] = (issuesByCode[issue.code] ?? 0) + 1;
  return {
    issues: issues.slice(0, STATUS_ISSUE_LIMIT),
    issuesTotal: issues.length,
    issuesTruncated: issues.length > STATUS_ISSUE_LIMIT,
    issuesByCode,
  };
}

/** The stored report keeps every issue; only its published copy is bounded. */
function summarizeSyncReport(report: SyncReport) {
  return { ...report, ...summarizeIssues(report.issues) };
}

export class ObjectFramework implements ObjectFacade {
  readonly definitions: readonly ObjectDefinition[];
  readonly registry: ObjectRegistry;
  readonly config: FrameworkConfig;
  private readonly runtime = ManagedRuntime.make(Layer.empty);
  private readonly gate = Semaphore.makeUnsafe(1);
  private readonly lifecycle = new AbortController();
  private readonly inFlight = new Set<Promise<unknown>>();
  private readonly listeners = new Set<(event: FrameworkEvent) => void>();
  private readonly store: FileStore;
  private readonly index: SqliteIndex;
  private readonly provider: EmbeddingProvider | undefined;
  private readonly fingerprint: string | undefined;
  private readonly synchronization: WatchLifecycle<SyncReport>;
  private closing = false;
  private closed = false;
  private closePromise: Promise<void> | undefined;
  private lastSync: SyncReport | undefined;
  private lastError: FrameworkError | undefined;
  private startupReconciliation!: Promise<SyncReport>;
  private startupPending = true;

  private constructor(
    config: FrameworkConfig,
    registry: ObjectRegistry,
    provider: EmbeddingProvider | undefined,
    private readonly reconciliation: "maintenance" | "projection",
    private readonly onError: (error: FrameworkError) => void,
  ) {
    this.config = config;
    // Registration is a boot-time operation: tools and watched directories share one immutable snapshot.
    this.registry = new ObjectRegistry(registry.definitions);
    // A relation target type may be registered after the definition naming it, so the
    // targets are checked once the registry is complete.
    this.registry.assertRelationTargets();
    this.definitions = this.registry.definitions;
    this.provider = provider;
    this.fingerprint = provider ? embeddingFingerprint(provider, config.chunking) : undefined;
    this.store = new FileStore(this.registry, config);
    this.index = new SqliteIndex(config.sqlite, config.search);
    this.synchronization = new WatchLifecycle(() => this.run((signal) => this.reconcile(signal)), {
      watcher: config.sync.watch
        ? new FileWatcher({
            root: config.root,
            stabilityThresholdMs: Math.max(100, config.sync.debounceMs),
          })
        : undefined,
      debounceMs: config.sync.debounceMs,
      rescanIntervalMs: config.sync.rescanIntervalMs,
      onChange: (change) =>
        this.emit({ kind: "source_changed", source: "filesystem", path: change.path }),
      onError: (error) => this.reportError(error),
      onComplete: (report) => {
        this.lastSync = report;
        this.emit({ kind: "sync_completed", source: "filesystem", report });
      },
    });
  }

  static async create(options: CreateFrameworkOptions): Promise<ObjectFramework> {
    if (!options || (!options.registry && !options.definitions))
      throw new FrameworkError(
        "CONFIG",
        "Pass an explicit registry or definitions to the library framework.",
      );
    const config = defineConfig(options.config, options.baseDirectory);
    if (options.registry && options.definitions)
      throw new FrameworkError("CONFIG", "Pass registry or definitions, not both.");
    const registry = options.registry ?? new ObjectRegistry(options.definitions);
    await mkdir(path.dirname(config.sqlite.path), { recursive: true });
    const provider =
      options.embeddingProvider ?? (await createEmbeddingProvider(config.embeddings));
    let framework: ObjectFramework | undefined;
    try {
      framework = new ObjectFramework(
        config,
        registry,
        provider,
        options.reconciliation ?? "maintenance",
        options.onError ?? (() => {}),
      );
      await framework.store.initialize();
      const started = framework;
      started.startupReconciliation = started.synchronization.start();
      // Handle rejection even when the host never awaits startup; retain the original promise.
      void started.startupReconciliation.then(
        () => {
          started.startupPending = false;
        },
        (error: unknown) => {
          started.startupPending = false;
          if (options.waitForStartup === false && !started.closing) started.reportError(error);
        },
      );
      if (options.waitForStartup !== false) await started.waitForStartup();
      return framework;
    } catch (error) {
      try {
        if (framework) await framework.close();
        else await provider?.close();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Framework startup and resource cleanup failed.",
          { cause: error },
        );
      }
      throw error;
    }
  }

  /** Resolves with the startup reconciliation report, or rejects with its failure. */
  waitForStartup(): Promise<SyncReport> {
    return this.startupReconciliation;
  }

  private ensureOpen(): void {
    if (this.closing || this.closed)
      throw new FrameworkError("CLOSED", "The object framework is closing or closed.");
  }

  private run<A>(
    work: (signal: AbortSignal) => Promise<A>,
    signal?: AbortSignal,
    locked = false,
  ): Promise<A> {
    this.ensureOpen();
    const combined = signal
      ? AbortSignal.any([signal, this.lifecycle.signal])
      : this.lifecycle.signal;
    const effect = Effect.tryPromise({ try: () => work(combined), catch: asFrameworkError });
    // Await the actual filesystem promise before releasing a permit, even when a request is interrupted.
    const program = (locked ? this.gate.withPermit(effect) : effect).pipe(Effect.uninterruptible);
    const operation = this.runtime.runPromiseExit(program, { signal: combined }).then((exit) => {
      if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
      return exit.value;
    });
    this.inFlight.add(operation);
    void operation.then(
      () => this.inFlight.delete(operation),
      () => this.inFlight.delete(operation),
    );
    return operation;
  }

  private async commit<A>(work: () => Promise<A>, signal: AbortSignal): Promise<A> {
    const effect = this.gate
      .withPermit(Effect.tryPromise({ try: work, catch: asFrameworkError }))
      .pipe(Effect.uninterruptible);
    const exit = await this.runtime.runPromiseExit(effect, { signal });
    if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
    return exit.value;
  }

  private reportError(error: unknown): void {
    this.lastError = asFrameworkError(error);
    try {
      this.onError(this.lastError);
    } catch {
      /* Host logging must not change source-of-truth behavior. */
    }
  }

  onEvent(listener: (event: FrameworkEvent) => void): () => void {
    this.ensureOpen();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: FrameworkEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.reportError(error);
      }
    }
  }

  requestResync(): void {
    if (this.closing || this.closed) return;
    this.synchronization.requestResync();
  }

  private indexMutation(document: SourceDocument): void {
    try {
      this.index.upsertDocument(document);
    } catch (error) {
      this.reportError(error);
    }
    this.requestResync();
  }

  create(type: string, object: unknown, body = "", signal?: AbortSignal): Promise<StoredObject> {
    object = normalizeIdentifiers(object);
    return this.run(
      async (inner) =>
        this.store.withProcessLock(async () => {
          const document = await this.store.create(type, object, body, inner);
          this.indexMutation(document);
          this.emit({ kind: "object_created", source: "tool", type, id: document.object.id });
          return publicObject(document);
        }, inner),
      signal,
      true,
    );
  }

  get(type: string, id: string, signal?: AbortSignal): Promise<ReadObject> {
    id = id.toLowerCase();
    return this.run(async (inner) => publicObject(await this.store.get(type, id, inner)), signal);
  }

  update(
    type: string,
    id: string,
    object: unknown,
    body: string,
    expectedChecksum: string,
    signal?: AbortSignal,
  ): Promise<StoredObject> {
    id = id.toLowerCase();
    object = normalizeIdentifiers(object);
    return this.run(
      async (inner) =>
        this.store.withProcessLock(async () => {
          const document = await this.store.update(type, id, object, body, expectedChecksum, inner);
          this.indexMutation(document);
          this.emit({ kind: "object_updated", source: "tool", type, id });
          return publicObject(document);
        }, inner),
      signal,
      true,
    );
  }

  delete(
    type: string,
    id: string,
    expectedChecksum: string,
    signal?: AbortSignal,
  ): Promise<{ type: string; id: string; deleted: true }> {
    id = id.toLowerCase();
    return this.run(
      async (inner) =>
        this.store.withProcessLock(async () => {
          await this.store.delete(type, id, expectedChecksum, inner);
          try {
            this.index.removeKeys([objectKey(type, id)]);
          } catch (error) {
            this.reportError(error);
          }
          this.requestResync();
          this.emit({ kind: "object_deleted", source: "tool", type, id });
          return { type, id, deleted: true as const };
        }, inner),
      signal,
      true,
    );
  }

  list(
    type: string,
    options: { limit?: number; offset?: number } = {},
    signal?: AbortSignal,
  ): Promise<ObjectListResult> {
    return this.run(async (inner) => {
      const limit = options.limit ?? LIST_LIMIT_DEFAULT;
      const offset = options.offset ?? 0;
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > LIST_LIMIT_MAX ||
        !Number.isSafeInteger(offset) ||
        offset < 0
      )
        throw new FrameworkError(
          "VALIDATION",
          `List limit must be 1..${LIST_LIMIT_MAX} and offset must be nonnegative integers.`,
        );
      const scan = await this.store.scan(type, inner);
      const semanticCodes = new Set(["FRONTMATTER", "YAML", "VALIDATION"]);
      const hasSourceOmission = scan.issues.some((i) => !semanticCodes.has(i.code));
      const degraded = !scan.complete || scan.conflictedKeys.length > 0 || hasSourceOmission;
      const documents = [...scan.documents].sort((a, b) => a.object.id.localeCompare(b.object.id));
      const observedCount = scan.documents.length;
      const paginated = documents.slice(offset, offset + limit).map(publicObject);
      const hasMore = offset + limit < observedCount;
      const continuation = hasMore ? { offset: offset + limit } : null;
      if (degraded) {
        return {
          objects: paginated,
          complete: false,
          total: null,
          observedCount,
          issues: scan.issues,
          continuation,
        };
      }
      return {
        objects: paginated,
        total: observedCount,
        complete: true,
        observedCount,
        issues: scan.issues,
        continuation,
      };
    }, signal);
  }

  /**
   * Answers a question about the relation graph: which objects a change reaches, and
   * which objects justify a change. The graph is read from the Markdown sources, so the
   * answer reflects the vault as it is on disk rather than the derived search index.
   */
  async relations(request: RelationsRequest, signal?: AbortSignal): Promise<RelationsResponse> {
    this.ensureOpen();
    const definition = this.registry.get(request.type);
    // The identifier is lowercased like every other read and is never trimmed, because
    // a stored id may carry surrounding spaces and trimming it would name another object.
    if (request.id.trim().length === 0)
      throw new FrameworkError("VALIDATION", "A relation query needs a nonempty object id.");
    const id = request.id.toLowerCase();
    const mode = request.mode ?? "neighbors";
    if (mode !== "neighbors" && mode !== "impact")
      throw new FrameworkError("VALIDATION", `Unknown relations mode: ${request.mode}.`);
    const direction = request.direction ?? "both";
    if (direction !== "incoming" && direction !== "outgoing" && direction !== "both")
      throw new FrameworkError("VALIDATION", `Unknown relations direction: ${request.direction}.`);
    if (mode === "impact" && request.direction !== undefined)
      throw new FrameworkError(
        "VALIDATION",
        "direction applies to the neighbors mode only; the impact mode derives its direction from the relation kind.",
      );
    const depth = request.depth ?? 1;
    if (!Number.isSafeInteger(depth) || depth < 1 || depth > RELATIONS_DEPTH_MAX)
      throw new FrameworkError(
        "VALIDATION",
        `depth must be an integer from 1 to ${RELATIONS_DEPTH_MAX}.`,
      );
    const kinds = new Set<RelationKind>(
      request.edgeKinds ?? (mode === "impact" ? RELATIONS_IMPACT_KINDS : RELATION_KINDS),
    );
    for (const kind of kinds)
      if (!RELATION_KINDS.includes(kind))
        throw new FrameworkError("VALIDATION", `Unknown relation kind: ${kind}.`);
    for (const type of request.types ?? []) this.registry.get(type);
    const includeRetired = request.includeRetired ?? true;
    const traversal: RelationTraversal = { mode, direction, kinds, depth };

    return this.run(async (inner) => {
      const scan = await this.store.scan(undefined, inner);
      if (!scan.complete)
        throw new FrameworkError(
          "SCAN",
          "The relation graph is incomplete because a directory cannot be read.",
        );
      const recoveredPaths = new Set(
        scan.documents.filter((document) => document.partial).map((document) => document.path),
      );
      const sourceConflicts = scan.issues.filter((issue) => !recoveredPaths.has(issue.path));
      const rootDocument = scan.documents.find(
        (document) =>
          document.type === definition.name && document.key === objectKey(definition.name, id),
      );
      if (rootDocument === undefined) {
        if (scan.conflictedKeys.includes(objectKey(definition.name, id)))
          throw new FrameworkError(
            "DUPLICATE_ID",
            `Multiple ${definition.name} files use id ${JSON.stringify(id)}.`,
            { type: definition.name, id },
          );
        if (sourceConflicts.length > 0)
          throw new FrameworkError(
            "SOURCE_CONFLICT",
            "The relation graph is incomplete because one or more source files could not be read as unique valid objects.",
            { issues: scan.issues },
          );
        throw new FrameworkError(
          "NOT_FOUND",
          `No ${definition.name} object with id ${JSON.stringify(id)}.`,
          { type: definition.name, id },
        );
      }
      if (sourceConflicts.length > 0)
        throw new FrameworkError(
          "SOURCE_CONFLICT",
          "The relation graph is incomplete because one or more source files could not be read as unique valid objects.",
          { issues: scan.issues },
        );
      const graph = buildRelationGraph(scan.documents, this.registry.definitions);
      const root: RelationNode = {
        type: rootDocument.type,
        ...documentLabels(rootDocument),
      };
      const walk = walkGraph(graph, root, traversal);

      const retired = new Set<string>();
      for (const document of scan.documents) {
        const timestamp = document.object.retiredAt;
        const isRetired = document.partial
          ? typeof timestamp === "string" &&
            /^\d{4}-\d{2}-\d{2}T/.test(timestamp) &&
            Number.isFinite(Date.parse(timestamp))
          : timestamp !== null;
        if (isRetired) retired.add(nodeKey(document.type, document.object.id));
      }
      const typeFilter = request.types === undefined ? undefined : new Set(request.types);
      const reported = (key: string): boolean => {
        if (!includeRetired && retired.has(key)) return false;
        if (typeFilter === undefined) return true;
        // A target that names no object carries the type its field declared, so a
        // filter classifies it rather than letting it through.
        const type = graph.nodeTypes.get(key);
        return type === undefined || typeFilter.has(type);
      };

      const allEdges = walk.discovered.map((discovered) => ({
        direction: discovered.forward ? ("outgoing" as const) : ("incoming" as const),
        kind: discovered.edge.kind,
        field: discovered.edge.field,
        from: discovered.edge.from,
        to: discovered.edge.to,
        distance: discovered.distance,
        affects: discovered.affects,
        nextKey: discovered.nextKey,
      }));
      const selected = allEdges.filter((edge) => reported(edge.nextKey));
      const edges: RelationEdge[] = selected.slice(0, RELATIONS_EDGE_LIMIT).map((edge) => ({
        direction: edge.direction,
        kind: edge.kind,
        field: edge.field,
        from: edge.from,
        to: edge.to,
        distance: edge.distance,
        affects: edge.affects,
      }));
      const affected = affectedObjects(walk.reached).filter((entry) => {
        const key = nodeKey(entry.type, entry.id);
        // A target that names no object is not an object, so it is not in the answer
        // set. Its edge and its finding still report the broken link.
        if (!graph.nodes.has(key)) return false;
        return reported(key);
      });
      const allFindings = relationFindings(
        walk.discovered.map((discovered) => discovered.edge),
        walk.cycles,
      );
      return {
        root,
        ...(scan.issues.length ? { complete: false as const, issues: scan.issues } : {}),
        mode,
        edges,
        affected,
        findings: allFindings.slice(0, RELATION_FINDING_LIMIT),
        totalEdges: allEdges.length,
        truncated: selected.length > RELATIONS_EDGE_LIMIT,
        findingsTotal: allFindings.length,
        findingsTruncated: allFindings.length > RELATION_FINDING_LIMIT,
      };
    }, signal);
  }

  resync(signal?: AbortSignal): Promise<SyncReport> {
    this.ensureOpen();
    return this.synchronization.resync(signal);
  }

  /**
   * Ensures the embedding provider can serve embeddings, fetching a missing model snapshot when the
   * configuration permits it. A failure is recorded as the last error and rethrown, so the host can
   * decide whether to keep serving the full-text path.
   */
  async prepareEmbeddings(signal?: AbortSignal): Promise<void> {
    this.ensureOpen();
    if (!this.provider) return;
    try {
      await this.provider.prepare?.(signal);
    } catch (error) {
      this.reportError(error);
      throw error;
    }
  }

  private async reconcile(signal: AbortSignal): Promise<SyncReport> {
    const snapshot = await this.commit(
      async () =>
        this.store.withProcessLock(async () => {
          const scan = await this.store.scan(undefined, signal);
          const result = reconcileSnapshot(
            {
              entries: scan.documents,
              complete:
                scan.complete &&
                (this.reconciliation === "maintenance" || scan.issues.length === 0),
              invalidated: scan.conflictedKeys,
            },
            {
              key: (document) => document.key,
              upsert: (document) => this.index.upsertDocument(document),
              removeMissing: (keys) => this.index.removeMissing(keys),
              // A confirmed conflict is evidence of invalidity even when the scan is incomplete.
              invalidate: (keys) => this.index.removeKeys(keys),
            },
          );
          const documents: ReadDocument[] = [];
          const issues: SyncIssue[] = [...scan.issues];
          for (const document of scan.documents) {
            if (this.reconciliation === "projection") {
              documents.push(document);
              continue;
            }
            if (document.partial) {
              // Partial documents are not renamed or rewritten during resync.
              documents.push(document);
              continue;
            }
            const basename = `${document.object.id}.md`;
            if (path.posix.basename(document.path) === basename) {
              documents.push(document);
              continue;
            }
            try {
              const outcome = await this.store.files.renameBasename(
                document.path,
                basename,
                document.checksum,
                signal,
              );
              if (outcome === "equivalent") {
                documents.push(document);
                continue;
              }
              const renamed = {
                ...document,
                path: path.posix.join(path.posix.dirname(document.path), basename),
              };
              this.index.upsertDocument(renamed);
              documents.push(renamed);
            } catch (error) {
              signal.throwIfAborted();
              this.index.removeKeys([document.key]);
              issues.push({
                path: document.path,
                code:
                  (error as { code?: unknown } | null)?.code === "EEXIST"
                    ? "RENAME_CONFLICT"
                    : "RENAME",
                message: error instanceof Error ? error.message : String(error),
              });
            }
          }
          return { scan: { ...scan, documents, issues }, ...result };
        }, signal),
      signal,
    );
    const issues: SyncIssue[] = [...snapshot.scan.issues];
    const provider = this.provider;
    const fingerprint = this.fingerprint;
    const pending =
      this.reconciliation === "maintenance" && provider && fingerprint
        ? snapshot.scan.documents.filter((document) =>
            this.index.needsEmbeddings(document.key, document.checksum, fingerprint),
          )
        : [];
    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(this.config.sync.concurrency, pending.length) },
      async () => {
        if (!provider || !fingerprint) return;
        while (cursor < pending.length) {
          signal.throwIfAborted();
          const document = pending[cursor++];
          if (!document) break;
          try {
            const chunks = await embedChunks(
              provider,
              chunkText(document.raw, this.config.chunking),
              signal,
            );
            await this.commit(async () => {
              signal.throwIfAborted();
              let raw: string;
              try {
                raw = await this.store.readRaw(document.path, signal);
              } catch (error) {
                signal.throwIfAborted();
                if ((error as { code?: unknown } | null)?.code !== "ENOENT") throw error;
                this.requestResync();
                return;
              }
              if (checksum(raw) !== document.checksum) {
                this.requestResync();
                return;
              }
              this.index.replaceEmbeddings(document.key, document.checksum, fingerprint, chunks);
            }, signal);
          } catch (error) {
            signal.throwIfAborted();
            issues.push({
              path: document.path,
              code: "EMBEDDING",
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      },
    );
    const settled = await Promise.allSettled(workers);
    const failed = settled.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    issues.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code));
    this.index.setIssues(issues);
    const report: SyncReport = {
      scanned: snapshot.scan.scanned,
      indexed: snapshot.indexed,
      unchanged: snapshot.unchanged,
      deleted: snapshot.deleted,
      issues,
      generation: this.index.status(this.fingerprint).generation,
    };
    return report;
  }

  search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResponse> {
    return this.run(async (inner) => {
      if (typeof request.query !== "string" || !request.query.trim())
        throw new FrameworkError("VALIDATION", "Search query must be nonempty.");
      if (request.types) for (const type of request.types) this.registry.get(type);
      const mode = request.mode ?? (this.provider ? "hybrid" : "fulltext");
      if (!["fulltext", "semantic", "hybrid"].includes(mode))
        throw new FrameworkError("VALIDATION", "Unknown search mode.");
      const topN = request.topN ?? this.config.search.defaultTopN;
      if (!Number.isSafeInteger(topN) || topN < 1 || topN > this.config.search.maxTopN)
        throw new FrameworkError(
          "VALIDATION",
          `topN must be an integer from 1 to ${this.config.search.maxTopN}.`,
        );
      if (request.types?.length === 0)
        return { mode, hits: [], indexGeneration: this.index.status(this.fingerprint).generation };
      let vector: Float32Array | undefined;
      if (mode !== "fulltext") {
        if (!this.provider)
          throw new FrameworkError(
            "EMBEDDINGS_DISABLED",
            "Configure ONNX or OpenAI embeddings to use semantic search.",
          );
        try {
          [vector] = await this.provider.embed([request.query], "query", inner);
        } catch (error) {
          throw new FrameworkError(
            "EMBEDDINGS_UNAVAILABLE",
            `Embedding provider failed: ${error instanceof Error ? error.message : String(error)}. Search with mode "fulltext" to query without embeddings.`,
            {},
            { cause: error },
          );
        }
      }
      inner.throwIfAborted();
      const response = this.index.search({ ...request, mode, topN }, vector, this.fingerprint);
      const valid: SearchHit[] = [];
      for (const hit of response.hits) {
        inner.throwIfAborted();
        try {
          const raw = await this.store.readRaw(hit.path, inner);
          if (checksum(raw) !== hit.checksum) {
            this.requestResync();
            continue;
          }
          const document = this.store.parse(hit.type, hit.path, raw);
          if (document.object.id !== hit.id) {
            this.requestResync();
            continue;
          }
          valid.push(
            document.partial
              ? {
                  ...hit,
                  partial: true,
                  object: document.object,
                  identity: document.identity,
                  issues: document.issues,
                }
              : hit,
          );
        } catch {
          inner.throwIfAborted();
          this.requestResync();
        }
      }
      return { ...response, hits: valid };
    }, signal);
  }

  status(): Record<string, unknown> {
    this.ensureOpen();
    const index = this.index.status(this.fingerprint);
    return {
      ...index,
      ...summarizeIssues(index.issues),
      root: this.config.root,
      registeredTypes: this.definitions.map((definition) => definition.name),
      syncing: this.startupPending || this.synchronization.syncing,
      dirty: this.synchronization.dirty || (this.startupPending && !this.synchronization.syncing),
      embeddings: {
        provider: this.config.embeddings.provider,
        fingerprint: this.fingerprint ?? null,
        dimensions: this.provider?.dimensions ?? null,
      },
      lastSync: this.lastSync ? summarizeSyncReport(this.lastSync) : null,
      lastError: this.lastError
        ? { code: this.lastError.code, message: this.lastError.message }
        : null,
    };
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.lifecycle.abort(new FrameworkError("CLOSED", "Framework is shutting down."));
    this.closePromise = (async () => {
      const errors: unknown[] = [];
      const dispose = async (work: () => unknown | Promise<unknown>) => {
        try {
          await work();
        } catch (error) {
          errors.push(error);
        }
      };
      await dispose(() => this.synchronization.shutdown());
      await Promise.allSettled([...this.inFlight]);
      await dispose(() => this.runtime.dispose());
      await dispose(() => this.provider?.close());
      await dispose(() => this.store.close());
      await dispose(() => this.index.close());
      this.listeners.clear();
      this.closed = true;
      if (errors.length) throw new AggregateError(errors, "Framework resource cleanup failed.");
    })();
    return this.closePromise;
  }
}

export const createFramework = (options: CreateFrameworkOptions): Promise<ObjectFramework> =>
  ObjectFramework.create(options);
