import {
  type Candidate,
  candidatesFor,
  type RelationGraph,
  type RelationTraversal,
} from "./relation-graph.ts";

export function candidateAdjacency(
  graph: RelationGraph,
  distances: ReadonlyMap<string, number>,
  traversal: RelationTraversal,
): Map<string, Candidate[]> {
  const adjacency = new Map<string, Candidate[]>();
  for (const [key, distance] of distances) {
    if (distance >= traversal.depth) continue;
    adjacency.set(
      key,
      candidatesFor(graph, key, traversal).filter((edge) => distances.has(edge.next)),
    );
  }
  return adjacency;
}

/** Keeps only edges that can belong to a directed cycle, using iterative Tarjan SCCs. */
export function directedCycleEdges(
  adjacency: ReadonlyMap<string, readonly Candidate[]>,
): Set<number> {
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const componentOf = new Map<string, number>();
  const componentSizes = new Map<number, number>();
  let nextIndex = 0;
  let nextComponent = 0;
  interface Frame {
    readonly node: string;
    readonly parent: string | undefined;
    nextEdge: number;
  }
  for (const start of adjacency.keys()) {
    if (indices.has(start)) continue;
    const frames: Frame[] = [];
    const discover = (node: string, parent: string | undefined): void => {
      const index = nextIndex++;
      indices.set(node, index);
      lowLinks.set(node, index);
      stack.push(node);
      onStack.add(node);
      frames.push({ node, parent, nextEdge: 0 });
    };
    discover(start, undefined);

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      if (frame === undefined) break;
      const outgoing = adjacency.get(frame.node) ?? [];
      const edge = outgoing[frame.nextEdge];
      if (edge !== undefined) {
        frame.nextEdge++;
        if (!indices.has(edge.next)) {
          discover(edge.next, frame.node);
        } else if (onStack.has(edge.next)) {
          const currentLow = lowLinks.get(frame.node);
          const neighborIndex = indices.get(edge.next);
          if (currentLow !== undefined && neighborIndex !== undefined)
            lowLinks.set(frame.node, Math.min(currentLow, neighborIndex));
        }
        continue;
      }

      frames.pop();
      if (frame.parent !== undefined) {
        const parentLow = lowLinks.get(frame.parent);
        const nodeLow = lowLinks.get(frame.node);
        if (parentLow !== undefined && nodeLow !== undefined)
          lowLinks.set(frame.parent, Math.min(parentLow, nodeLow));
      }
      const nodeLow = lowLinks.get(frame.node);
      const nodeIndex = indices.get(frame.node);
      if (nodeLow === undefined || nodeIndex === undefined || nodeLow !== nodeIndex) continue;
      const component = nextComponent++;
      let size = 0;
      while (stack.length > 0) {
        const member = stack.pop();
        if (member === undefined) break;
        onStack.delete(member);
        componentOf.set(member, component);
        size++;
        if (member === frame.node) break;
      }
      componentSizes.set(component, size);
    }
  }

  const edges = new Set<number>();
  for (const [node, candidates] of adjacency)
    for (const candidate of candidates) {
      const component = componentOf.get(node);
      const targetComponent = componentOf.get(candidate.next);
      if (component !== undefined && component === targetComponent) {
        const size = componentSizes.get(component) ?? 0;
        if (size > 1 || candidate.next === node) edges.add(candidate.edge.index);
      }
    }
  return edges;
}

/** Keeps only non-bridge edges using an iterative low-link walk of the neighbor graph. */
export function undirectedCycleEdges(
  adjacency: ReadonlyMap<string, readonly Candidate[]>,
): Set<number> {
  const edges = new Map<number, Candidate["edge"]>();
  const incident = new Map<string, Set<number>>();
  for (const candidates of adjacency.values())
    for (const candidate of candidates) {
      edges.set(candidate.edge.index, candidate.edge);
      const fromEdges = incident.get(candidate.edge.fromKey) ?? new Set<number>();
      fromEdges.add(candidate.edge.index);
      incident.set(candidate.edge.fromKey, fromEdges);
      const toEdges = incident.get(candidate.edge.toKey) ?? new Set<number>();
      toEdges.add(candidate.edge.index);
      incident.set(candidate.edge.toKey, toEdges);
    }

  const discovery = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const bridges = new Set<number>();
  let nextIndex = 0;
  interface Frame {
    readonly node: string;
    readonly parent: string | undefined;
    readonly parentEdge: number | undefined;
    readonly adjacent: readonly number[];
    nextEdge: number;
  }
  for (const start of incident.keys()) {
    if (discovery.has(start)) continue;
    const frames: Frame[] = [];
    const discover = (
      node: string,
      parent: string | undefined,
      parentEdge: number | undefined,
    ): void => {
      const index = nextIndex++;
      discovery.set(node, index);
      lowLink.set(node, index);
      frames.push({
        node,
        parent,
        parentEdge,
        adjacent: [...(incident.get(node) ?? [])],
        nextEdge: 0,
      });
    };
    discover(start, undefined, undefined);

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      if (frame === undefined) break;
      const edgeIndex = frame.adjacent[frame.nextEdge];
      if (edgeIndex !== undefined) {
        frame.nextEdge++;
        if (edgeIndex === frame.parentEdge) continue;
        const edge = edges.get(edgeIndex);
        if (edge === undefined) continue;
        const next = edge.fromKey === frame.node ? edge.toKey : edge.fromKey;
        if (next === frame.node) continue;
        if (!discovery.has(next)) {
          discover(next, frame.node, edgeIndex);
        } else {
          const currentLow = lowLink.get(frame.node);
          const neighborIndex = discovery.get(next);
          if (currentLow !== undefined && neighborIndex !== undefined)
            lowLink.set(frame.node, Math.min(currentLow, neighborIndex));
        }
        continue;
      }

      frames.pop();
      if (frame.parent === undefined || frame.parentEdge === undefined) continue;
      const parentLow = lowLink.get(frame.parent);
      const nodeLow = lowLink.get(frame.node);
      const parentIndex = discovery.get(frame.parent);
      if (parentLow === undefined || nodeLow === undefined || parentIndex === undefined) continue;
      lowLink.set(frame.parent, Math.min(parentLow, nodeLow));
      if (nodeLow > parentIndex) bridges.add(frame.parentEdge);
    }
  }
  return new Set([...edges.keys()].filter((edgeIndex) => !bridges.has(edgeIndex)));
}
