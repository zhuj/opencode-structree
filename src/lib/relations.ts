import { findCycles, type RelationCycle } from "./relation-cycles.ts";
import {
  candidatesFor,
  type InternalEdge,
  nodeKey,
  type RelationGraph,
  type RelationTraversal,
} from "./relation-graph.ts";
import type {
  AffectedObject,
  RelationEdge,
  RelationFinding,
  RelationKind,
  RelationNode,
} from "./types.ts";

export interface DiscoveredEdge {
  readonly edge: InternalEdge;
  readonly affects: "from" | "to" | null;
  /** True when the walk followed the stored direction of the edge. */
  readonly forward: boolean;
  readonly distance: number;
  /** The node the walk moved toward, which is the endpoint a type filter applies to. */
  readonly nextKey: string;
}

export interface GraphWalk {
  /** The edges the walk discovered, in discovery order. */
  readonly discovered: readonly DiscoveredEdge[];
  /** The nodes the walk reached, with the path that reached them. */
  readonly reached: readonly {
    readonly key: string;
    readonly node: RelationNode;
    readonly distance: number;
    readonly kind: RelationKind;
    readonly via: readonly RelationNode[];
  }[];
  /** The cycles the walk found. */
  readonly cycles: readonly RelationCycle[];
}

/**
 * Walks the graph breadth-first, so a node is reached once at its shortest distance.
 */
export function walkGraph(
  graph: RelationGraph,
  root: RelationNode,
  traversal: RelationTraversal,
): GraphWalk {
  const rootKey = nodeKey(root.type, root.id);
  const discovered = new Map<number, DiscoveredEdge>();
  const reached: {
    key: string;
    node: RelationNode;
    distance: number;
    kind: RelationKind;
    via: RelationNode[];
  }[] = [];
  const visited = new Set<string>([rootKey]);
  let frontier: { key: string; via: RelationNode[] }[] = [{ key: rootKey, via: [root] }];

  for (let level = 1; level <= traversal.depth && frontier.length > 0; level++) {
    const next: { key: string; via: RelationNode[] }[] = [];
    for (const current of frontier) {
      for (const candidate of candidatesFor(graph, current.key, traversal)) {
        // The first discovery wins. It is the one nearest the root, so the reported
        // direction and the endpoint a type filter applies to stay stable when the
        // same edge is met again from its other end.
        if (!discovered.has(candidate.edge.index))
          discovered.set(candidate.edge.index, {
            edge: candidate.edge,
            affects: candidate.affects,
            forward: candidate.forward,
            distance: level,
            nextKey: candidate.next,
          });
        if (visited.has(candidate.next)) continue;
        visited.add(candidate.next);
        const node =
          graph.nodes.get(candidate.next) ??
          (candidate.next === candidate.edge.fromKey ? candidate.edge.from : candidate.edge.to);
        const via = [...current.via, node];
        reached.push({
          key: candidate.next,
          node,
          distance: level,
          kind: candidate.edge.kind,
          via,
        });
        next.push({ key: candidate.next, via });
      }
    }
    frontier = next;
  }

  return {
    discovered: [...discovered.values()].sort((a, b) => a.edge.index - b.edge.index),
    reached,
    cycles: findCycles(graph, rootKey, traversal),
  };
}

/** The link defects the model does not prevent, reported instead of hidden. */
export function relationFindings(
  edges: readonly InternalEdge[],
  cycles: readonly RelationCycle[],
): RelationFinding[] {
  const findings: RelationFinding[] = [];
  const seen = new Set<string>();
  const push = (code: string, message: string, edge: InternalEdge): void => {
    const key = `${code}|${edge.index}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({
      code,
      message,
      edge: { kind: edge.kind, field: edge.field, from: edge.from, to: edge.to },
    });
  };
  for (const edge of edges) {
    if (edge.targetOwners === 0)
      push(
        "DANGLING_TARGET",
        `${edge.from.type} ${edge.from.id} links to ${edge.to.id}, which is not an object of any type.`,
        edge,
      );
    else if (edge.actualType !== edge.declaredType && edge.actualType !== null)
      push(
        "TARGET_TYPE_MISMATCH",
        `${edge.from.type} ${edge.from.id} declares ${edge.declaredType} in ${edge.field}, but ${edge.to.id} is an ${edge.actualType}.`,
        edge,
      );
    else if (edge.actualType === null && edge.targetOwners > 1)
      push(
        "AMBIGUOUS_TARGET",
        `${edge.from.type} ${edge.from.id} declares ${edge.declaredType} in ${edge.field}, but ${edge.to.id} is held by ${edge.targetOwners} types.`,
        edge,
      );
  }
  for (const cycle of cycles) {
    const closing = cycle.edges[cycle.edges.length - 1];
    if (closing === undefined) continue;
    push(
      "CYCLE",
      `${closing.from.type} ${closing.from.id} closes a cycle through ${closing.field}.`,
      closing,
    );
  }
  return findings;
}

/** The affected set a walk produced, in the order the walk reached it. */
export function affectedObjects(
  reached: readonly {
    readonly key: string;
    readonly node: RelationNode;
    readonly distance: number;
    readonly kind: RelationKind;
    readonly via: readonly RelationNode[];
  }[],
): AffectedObject[] {
  return reached.map((entry) => ({
    type: entry.node.type,
    id: entry.node.id,
    name: entry.node.name,
    title: entry.node.title,
    distance: entry.distance,
    kind: entry.kind,
    via: entry.via,
  }));
}

export type { RelationEdge };
