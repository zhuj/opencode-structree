import { FrameworkError } from "../errors.ts";
import type { FileStore, ScanResult } from "../filesystem.ts";
import type { ObjectRegistry } from "../registry.ts";
import type {
  FrameworkConfig,
  ObjectFacade,
  SearchMode,
  SearchRequest,
  SearchResponse,
  SourceSearchResponse,
} from "../types.ts";
import { hasSourceOmission } from "./list.ts";
import { searchSourceDocuments, validateSourceSearchQuery } from "./search.ts";
import type { CapabilityReadiness } from "./types.ts";

interface SourceSearchContext {
  readonly config: Pick<FrameworkConfig, "embeddings" | "search">;
  readonly registry: ObjectRegistry;
  readonly store: FileStore;
  readonly readiness: () => CapabilityReadiness;
  readonly capability: () => ObjectFacade;
  readonly ensureOpen: () => void;
  readonly lifecycleSignal: AbortSignal;
  readonly runSource: (
    work: (signal: AbortSignal) => Promise<SearchResponse>,
    signal?: AbortSignal,
  ) => Promise<SearchResponse>;
}

export function createSourceSearch(context: SourceSearchContext) {
  const { config, registry, store, readiness, capability, ensureOpen, lifecycleSignal, runSource } =
    context;

  return async function search(
    request: SearchRequest,
    signal?: AbortSignal,
  ): Promise<SearchResponse> {
    ensureOpen();
    if (typeof request.query !== "string" || !request.query.trim())
      throw new FrameworkError("VALIDATION", "Search query must be nonempty.");
    if (request.types !== undefined && !Array.isArray(request.types))
      throw new FrameworkError("VALIDATION", "Search types must be an array of registered types.");
    if (request.types) for (const type of request.types) registry.get(type);
    const requestedMode: SearchMode =
      request.mode === undefined
        ? config.embeddings.provider === "disabled"
          ? "fulltext"
          : "hybrid"
        : request.mode;
    if (!["fulltext", "semantic", "hybrid"].includes(requestedMode))
      throw new FrameworkError("VALIDATION", "Unknown search mode.");
    const topN = request.topN === undefined ? config.search.defaultTopN : request.topN;
    if (!Number.isSafeInteger(topN) || topN < 1 || topN > config.search.maxTopN)
      throw new FrameworkError(
        "VALIDATION",
        `topN must be an integer from 1 to ${config.search.maxTopN}.`,
      );
    if (request.includeBody !== undefined && typeof request.includeBody !== "boolean")
      throw new FrameworkError("VALIDATION", "includeBody must be a boolean.");
    const normalizedRequest = { ...request, mode: requestedMode, topN };
    const recoveryCode = (): SourceSearchResponse["recovery"]["code"] => {
      switch (readiness().state) {
        case "idle":
          return "SOURCE_ONLY";
        case "starting":
          return "CAPABILITY_STARTING";
        case "failed":
          return "CAPABILITY_FAILED";
        case "ready":
          return "DERIVED_SEARCH_FAILED";
        case "closed":
          throw new FrameworkError("CLOSED", "Source access is closed.");
        default:
          throw new Error("Unhandled capability readiness state.");
      }
    };
    const sourceFallback = (code: SourceSearchResponse["recovery"]["code"]) => {
      validateSourceSearchQuery(request.query);
      return runSource(async (inner) => {
        inner.throwIfAborted();
        if (request.types?.length === 0)
          return searchSourceDocuments({
            documents: [],
            request: normalizedRequest,
            requestedMode,
            complete: true,
            observedCount: 0,
            issues: [],
            recoveryCode: code,
          });
        const types = request.types === undefined ? undefined : [...new Set(request.types)];
        const scans: ScanResult[] = [];
        if (types) {
          for (const type of types) scans.push(await store.scan(type, inner));
        } else {
          scans.push(await store.scan(undefined, inner));
        }
        inner.throwIfAborted();
        const documents = scans.flatMap((scan) => scan.documents);
        const issues = scans.flatMap((scan) => scan.issues);
        const complete = scans.every(
          (scan) => scan.complete && scan.conflictedKeys.length === 0 && !hasSourceOmission(scan),
        );
        return searchSourceDocuments({
          documents,
          request: normalizedRequest,
          requestedMode,
          complete,
          observedCount: documents.length,
          issues,
          recoveryCode: code,
        });
      }, signal);
    };
    if (signal?.aborted) signal.throwIfAborted();
    if (readiness().state !== "ready") return sourceFallback(recoveryCode());
    const activeFacade = capability();
    let derivedStatus: Record<string, unknown> | undefined;
    try {
      derivedStatus = activeFacade.status();
    } catch {
      // A missing or failed legacy status is not evidence that the index is unready.
    }
    const semanticIndexPending =
      requestedMode !== "fulltext" &&
      typeof derivedStatus?.pendingEmbeddings === "number" &&
      Number.isFinite(derivedStatus.pendingEmbeddings) &&
      derivedStatus.pendingEmbeddings > 0;
    if (
      derivedStatus?.syncing === true ||
      derivedStatus?.dirty === true ||
      derivedStatus?.lastSync === null
    )
      return sourceFallback("INDEX_NOT_READY");
    if (semanticIndexPending) return sourceFallback("SEMANTIC_INDEX_NOT_READY");
    try {
      return await activeFacade.search(normalizedRequest, signal);
    } catch (error) {
      if (signal?.aborted || lifecycleSignal.aborted) throw error;
      if (error instanceof Error && error.name === "AbortError") throw error;
      if (
        error instanceof FrameworkError &&
        ["VALIDATION", "UNKNOWN_TYPE", "CLOSED"].includes(error.code)
      )
        throw error;
      return sourceFallback("DERIVED_SEARCH_FAILED");
    }
  };
}
