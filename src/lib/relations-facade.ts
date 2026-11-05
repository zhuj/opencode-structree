import { FrameworkError } from "./errors.ts";
import { type FileStore, objectKey } from "./filesystem.ts";
import { RELATION_KIND_ORDER } from "./model/index.ts";
import { documentLabels } from "./read-document.ts";
import type { ObjectRegistry } from "./registry.ts";
import { buildRelationGraph, nodeKey, type RelationTraversal } from "./relation-graph.ts";
import { affectedObjects, relationFindings, walkGraph } from "./relations.ts";
import {
  RELATIONS_DEPTH_MAX,
  RELATIONS_EDGE_LIMIT,
  RELATIONS_IMPACT_KINDS,
  type RelationEdge,
  type RelationKind,
  type RelationNode,
  type RelationsRequest,
  type RelationsResponse,
} from "./types.ts";

/** The number of findings one relation response carries before it summarizes the rest. */
const RELATION_FINDING_LIMIT = 100;

/** Collaborators the relations facade needs from the owning framework. */
export interface RelationsFacadeDeps {
  readonly ensureOpen: () => void;
  readonly registry: ObjectRegistry;
  readonly store: FileStore;
  readonly run: <A>(work: (signal: AbortSignal) => Promise<A>, signal?: AbortSignal) => Promise<A>;
}

/** Answers relation-graph questions against the vault sources, with the framework's lifecycle and serialization. */
export interface RelationsFacade {
  relations(request: RelationsRequest, signal?: AbortSignal): Promise<RelationsResponse>;
}

/**
 * Creates the relations facade. The method body is a verbatim move of the
 * ObjectFramework.relations implementation; only the framework receivers are
 * substituted by the injected dependencies.
 */
export function createRelationsFacade(deps: RelationsFacadeDeps): RelationsFacade {
  return {
    /**
     * Answers a question about the relation graph: which objects a change reaches, and
     * which objects justify a change. The graph is read from the Markdown sources, so the
     * answer reflects the vault as it is on disk rather than the derived search index.
     */
    async relations(request: RelationsRequest, signal?: AbortSignal): Promise<RelationsResponse> {
      deps.ensureOpen();
      const definition = deps.registry.get(request.type);
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
        throw new FrameworkError(
          "VALIDATION",
          `Unknown relations direction: ${request.direction}.`,
        );
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
        request.edgeKinds ?? (mode === "impact" ? RELATIONS_IMPACT_KINDS : RELATION_KIND_ORDER),
      );
      for (const kind of kinds)
        if (!RELATION_KIND_ORDER.includes(kind))
          throw new FrameworkError("VALIDATION", `Unknown relation kind: ${kind}.`);
      for (const type of request.types ?? []) deps.registry.get(type);
      const includeRetired = request.includeRetired ?? true;
      const traversal: RelationTraversal = { mode, direction, kinds, depth };

      return deps.run(async (inner) => {
        const scan = await deps.store.scan(undefined, inner);
        if (!scan.complete)
          throw new FrameworkError(
            "SCAN",
            scan.issues.some((issue) => issue.code === "SCAN_BUDGET")
              ? "The relation graph is unavailable because the scan stopped at the configured sync.maxScanTotalCharacters budget."
              : "The relation graph is incomplete because a directory cannot be read.",
            { issues: scan.issues },
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
        const graph = buildRelationGraph(scan.documents, deps.registry.definitions);
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
    },
  };
}
