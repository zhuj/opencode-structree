import { isValidId } from "./base-schema.ts";
import { documentLabels } from "./read-document.ts";
import type {
  ObjectDefinition,
  ReadDocument,
  RelationDescriptor,
  RelationKind,
  RelationNode,
  RelationsMode,
} from "./types.ts";

export interface InternalEdge {
  readonly index: number;
  readonly kind: RelationKind;
  readonly field: string;
  readonly fromKey: string;
  readonly toKey: string;
  readonly from: RelationNode;
  readonly to: RelationNode;
  readonly declaredType: string;
  /** The type that actually holds the target id, or null when the target does not exist. */
  readonly actualType: string | null;
  /** The number of types that hold the target id. */
  readonly targetOwners: number;
}

export interface RelationGraph {
  readonly edges: readonly InternalEdge[];
  /** Every object in the vault, indexed by its node key. */
  readonly nodes: ReadonlyMap<string, RelationNode>;
  /** The type of every node key the graph can name, including unresolved targets. */
  readonly nodeTypes: ReadonlyMap<string, string>;
  /** Every edge incident to a node, indexed by the node key. */
  readonly incident: ReadonlyMap<string, readonly InternalEdge[]>;
}

export interface RelationTraversal {
  readonly mode: RelationsMode;
  readonly direction: "incoming" | "outgoing" | "both";
  readonly kinds: ReadonlySet<RelationKind>;
  readonly depth: number;
}

export const nodeKey = (type: string, id: string): string => `${type}:${id}`;

/**
 * A change to the target of these kinds propagates to the holder: the holder depends on,
 * is justified by, is contained in, or is owned by the target.
 */
const TARGET_TO_HOLDER: ReadonlySet<RelationKind> = new Set([
  "depends",
  "justifies",
  "contains",
  "owns",
]);

/**
 * A change to the holder of these kinds propagates to the target. A usage relation is
 * stored on the provider, so it is the only kind whose impact runs along the stored edge.
 */
const HOLDER_TO_TARGET: ReadonlySet<RelationKind> = new Set(["uses"]);

export interface Candidate {
  readonly edge: InternalEdge;
  readonly next: string;
  /** The endpoint a change to the other endpoint propagates to. */
  readonly affects: "from" | "to" | null;
  /** True when the walk followed the stored direction of the edge. */
  readonly forward: boolean;
}

/**
 * The edges that carry a change from a node. The neighbors mode follows the stored edge
 * direction; the impact mode follows the kind's impact direction, which for a usage
 * relation is the stored direction and for every other kind is its reverse.
 */
export function candidatesFor(
  graph: RelationGraph,
  key: string,
  traversal: RelationTraversal,
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const edge of graph.incident.get(key) ?? []) {
    if (!traversal.kinds.has(edge.kind)) continue;
    const isForward = edge.fromKey === key;
    const isBackward = edge.toKey === key;
    if (traversal.mode === "impact") {
      if (isBackward && TARGET_TO_HOLDER.has(edge.kind))
        candidates.push({ edge, next: edge.fromKey, affects: "from", forward: false });
      else if (isForward && HOLDER_TO_TARGET.has(edge.kind))
        candidates.push({ edge, next: edge.toKey, affects: "to", forward: true });
      continue;
    }
    if ((traversal.direction === "both" || traversal.direction === "outgoing") && isForward)
      candidates.push({ edge, next: edge.toKey, affects: null, forward: true });
    if ((traversal.direction === "both" || traversal.direction === "incoming") && isBackward)
      candidates.push({ edge, next: edge.fromKey, affects: null, forward: false });
  }
  return candidates;
}

const readPath = (value: unknown, path: string): unknown => {
  let current = value;
  for (const segment of path.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

const targetIds = (value: unknown, cardinality: RelationDescriptor["cardinality"]): string[] => {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (cardinality === "one" && typeof value === "string") return [value];
  return [];
};

/**
 * Builds the relation graph from the source documents. The target type of an edge is
 * resolved against the objects that actually exist, because the model stores relation
 * targets as written and never checks that they name an object of the declared type.
 */
export function buildRelationGraph(
  documents: readonly ReadDocument[],
  definitions: readonly ObjectDefinition[],
): RelationGraph {
  const descriptors = new Map<string, readonly RelationDescriptor[]>();
  for (const definition of definitions)
    descriptors.set(definition.name, definition.relations ?? []);

  const nodes = new Map<string, RelationNode>();
  // Every node key the graph can name, including a target that names no object, so a
  // type filter can classify an unresolved target instead of letting it through.
  const nodeTypes = new Map<string, string>();
  const typesById = new Map<string, Set<string>>();
  for (const document of documents) {
    const node: RelationNode = {
      type: document.type,
      ...documentLabels(document),
    };
    const key = nodeKey(node.type, node.id);
    nodes.set(key, node);
    nodeTypes.set(key, node.type);
    const owners = typesById.get(node.id) ?? new Set<string>();
    owners.add(document.type);
    typesById.set(node.id, owners);
  }

  const edges: InternalEdge[] = [];
  for (const document of documents) {
    const relations = readPath(document.json, "relations");
    const from = nodes.get(nodeKey(document.type, document.object.id));
    if (from === undefined) continue;
    for (const descriptor of descriptors.get(document.type) ?? []) {
      const declared = descriptor.targetType;
      const value = readPath(relations, descriptor.path);
      // Partial headers have not passed a relation codec. Accept only a complete,
      // correctly shaped field of portable target ids for the registered descriptor.
      if (
        document.partial &&
        !(descriptor.cardinality === "one"
          ? value === null || (typeof value === "string" && isValidId(value))
          : Array.isArray(value) &&
            value.every((item) => typeof item === "string" && isValidId(item)))
      )
        continue;
      for (const id of targetIds(value, descriptor.cardinality)) {
        const owners = typesById.get(id);
        const ownerTypes = owners === undefined ? [] : [...owners];
        const ownerCount = ownerTypes.length;
        const holdsDeclared = ownerTypes.includes(declared);
        const actualType = holdsDeclared
          ? declared
          : ownerTypes.length === 1
            ? (ownerTypes[0] ?? null)
            : null;
        const to: RelationNode = actualType
          ? (nodes.get(nodeKey(actualType, id)) ?? { type: actualType, id, name: "", title: "" })
          : { type: declared, id, name: "", title: "" };
        nodeTypes.set(nodeKey(to.type, to.id), to.type);
        edges.push({
          index: edges.length,
          kind: descriptor.kind,
          field: `relations.${descriptor.path}`,
          fromKey: nodeKey(from.type, from.id),
          toKey: nodeKey(to.type, to.id),
          from,
          to,
          declaredType: declared,
          actualType,
          targetOwners: ownerCount,
        });
      }
    }
  }

  const incident = new Map<string, InternalEdge[]>();
  for (const edge of edges) {
    const fromEdges = incident.get(edge.fromKey) ?? [];
    fromEdges.push(edge);
    incident.set(edge.fromKey, fromEdges);
    if (edge.toKey !== edge.fromKey) {
      const toEdges = incident.get(edge.toKey) ?? [];
      toEdges.push(edge);
      incident.set(edge.toKey, toEdges);
    }
  }
  return { edges, nodes, nodeTypes, incident };
}
