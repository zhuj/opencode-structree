import {
  candidateAdjacency,
  directedCycleEdges,
  undirectedCycleEdges,
} from "./relation-cycle-pruning.ts";
import {
  type Candidate,
  candidatesFor,
  type InternalEdge,
  type RelationGraph,
  type RelationTraversal,
} from "./relation-graph.ts";

/** A closed walk that repeats a node, with the edges that close it. */
export interface RelationCycle {
  readonly edges: readonly InternalEdge[];
  readonly node: string;
}

/** The distance from the root to every node the walk can reach within the budget. */
function reachableDistances(
  graph: RelationGraph,
  rootKey: string,
  traversal: RelationTraversal,
): Map<string, number> {
  const distances = new Map<string, number>([[rootKey, 0]]);
  let frontier = [rootKey];
  for (let level = 1; level <= traversal.depth && frontier.length > 0; level++) {
    const next: string[] = [];
    for (const key of frontier) {
      for (const candidate of candidatesFor(graph, key, traversal)) {
        if (distances.has(candidate.next)) continue;
        distances.set(candidate.next, level);
        next.push(candidate.next);
      }
    }
    frontier = next;
  }
  return distances;
}

/** The shortest undirected return path, omitting the first edge to prevent retracing. */
interface UndirectedCycleSearch {
  readonly graph: RelationGraph;
  readonly traversal: RelationTraversal;
  readonly allowedEdges: ReadonlySet<number>;
}

function shortestUndirectedReturnPath(
  search: UndirectedCycleSearch,
  source: string,
  target: string,
  budget: number,
  excludedEdge: number,
): InternalEdge[] | undefined {
  const distances = new Map<string, number>([[source, 0]]);
  const parents = new Map<string, string>();
  const parentEdges = new Map<string, InternalEdge>();
  const queue = [source];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    if (current === undefined) continue;
    const distance = distances.get(current);
    if (distance === undefined) continue;
    if (distance >= budget) continue;
    for (const candidate of candidatesFor(search.graph, current, search.traversal)) {
      if (candidate.edge.index === excludedEdge || !search.allowedEdges.has(candidate.edge.index))
        continue;
      if (candidate.next === target) {
        const path = pathEdges(current, parents, parentEdges);
        return [...path, candidate.edge];
      }
      if (distances.has(candidate.next)) continue;
      distances.set(candidate.next, distance + 1);
      parents.set(candidate.next, current);
      parentEdges.set(candidate.next, candidate.edge);
      queue.push(candidate.next);
    }
  }
  return source === target ? [] : undefined;
}

interface ReverseEdge {
  readonly from: string;
  readonly edge: InternalEdge;
}

/** Builds the reverse traversal adjacency once for directed cycle searches. */
function reverseAdjacency(
  adjacency: ReadonlyMap<string, readonly Candidate[]>,
  allowedEdges: ReadonlySet<number>,
): Map<string, ReverseEdge[]> {
  const reverse = new Map<string, ReverseEdge[]>();
  for (const [from, candidates] of adjacency)
    for (const candidate of candidates) {
      if (!allowedEdges.has(candidate.edge.index)) continue;
      const incoming = reverse.get(candidate.next) ?? [];
      incoming.push({ from, edge: candidate.edge });
      reverse.set(candidate.next, incoming);
    }
  return reverse;
}

/** Finds shortest return paths from each node to one start in a single reverse BFS. */
function shortestDirectedReturnPaths(
  start: string,
  budget: number,
  reverse: ReadonlyMap<string, readonly ReverseEdge[]>,
): {
  readonly distances: ReadonlyMap<string, number>;
  readonly next: ReadonlyMap<string, ReverseEdge>;
} {
  const distances = new Map<string, number>([[start, 0]]);
  const next = new Map<string, ReverseEdge>();
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    if (current === undefined) continue;
    const distance = distances.get(current);
    if (distance === undefined || distance >= budget) continue;
    for (const edge of reverse.get(current) ?? []) {
      if (distances.has(edge.from)) continue;
      distances.set(edge.from, distance + 1);
      next.set(edge.from, { from: current, edge: edge.edge });
      queue.push(edge.from);
    }
  }
  return { distances, next };
}

function pathToStart(
  node: string,
  start: string,
  next: ReadonlyMap<string, ReverseEdge>,
): InternalEdge[] {
  const path: InternalEdge[] = [];
  let current = node;
  while (current !== start) {
    const step = next.get(current);
    if (step === undefined) return [];
    path.push(step.edge);
    current = step.from;
  }
  return path;
}

function pathEdges(
  from: string,
  parents: ReadonlyMap<string, string>,
  parentEdges: ReadonlyMap<string, InternalEdge>,
): InternalEdge[] {
  const edges: InternalEdge[] = [];
  let current = from;
  while (parents.has(current)) {
    const edge = parentEdges.get(current);
    if (edge === undefined) break;
    edges.push(edge);
    const parent = parents.get(current);
    if (parent === undefined) break;
    current = parent;
  }
  return edges.reverse();
}

/**
 * Finds the genuine cycles within the hop budget.
 *
 * A cycle is reported when the walk can go around it within the budget: the walk
 * reaches a node of the cycle at distance d, and going around a cycle of length L
 * costs L more hops, so the cycle is reported when d + L stays within the depth.
 *
 * Directed cycles share one reverse BFS per reachable start. Bidirectional neighbors
 * remove bridges first, then use a bounded BFS that excludes the first edge. This
 * distinguishes cycles from retracing and avoids path searches through acyclic regions.
 */
export function findCycles(
  graph: RelationGraph,
  rootKey: string,
  traversal: RelationTraversal,
): RelationCycle[] {
  const distances = reachableDistances(graph, rootKey, traversal);
  const adjacency = candidateAdjacency(graph, distances, traversal);
  const allowedEdges =
    traversal.mode === "neighbors" && traversal.direction === "both"
      ? undirectedCycleEdges(adjacency)
      : directedCycleEdges(adjacency);
  if (allowedEdges.size === 0) return [];
  const undirected = traversal.mode === "neighbors" && traversal.direction === "both";
  const reverse = undirected ? undefined : reverseAdjacency(adjacency, allowedEdges);
  const undirectedSearch: UndirectedCycleSearch = { graph, traversal, allowedEdges };
  const cycles = new Map<string, RelationCycle>();
  for (const [start, distance] of distances) {
    const budget = traversal.depth - distance;
    if (budget < 1) continue;
    const returns =
      reverse === undefined ? undefined : shortestDirectedReturnPaths(start, budget - 1, reverse);
    for (const candidate of adjacency.get(start) ?? []) {
      if (!allowedEdges.has(candidate.edge.index)) continue;
      let cycleEdges: InternalEdge[] | undefined;
      if (candidate.next === start) cycleEdges = [candidate.edge];
      else if (budget > 1) {
        const returnDistance = returns?.distances.get(candidate.next);
        const returnPath = undirected
          ? shortestUndirectedReturnPath(
              undirectedSearch,
              candidate.next,
              start,
              budget - 1,
              candidate.edge.index,
            )
          : returnDistance === undefined || returns === undefined
            ? undefined
            : pathToStart(candidate.next, start, returns.next);
        if (returnPath !== undefined) cycleEdges = [candidate.edge, ...returnPath];
      }
      if (cycleEdges === undefined) continue;
      const key = cycleEdges
        .map((edge) => edge.index)
        .sort((a, b) => a - b)
        .join(",");
      if (!cycles.has(key)) cycles.set(key, { edges: cycleEdges, node: start });
    }
  }
  return [...cycles.values()];
}
