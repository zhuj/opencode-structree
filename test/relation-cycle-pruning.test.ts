import { describe, expect, test } from "bun:test";
import { directedCycleEdges, undirectedCycleEdges } from "../src/lib/relation-cycle-pruning.ts";
import type { Candidate, InternalEdge } from "../src/lib/relation-graph.ts";

function chainAdjacency(size: number, undirected: boolean): Map<string, Candidate[]> {
  const adjacency = new Map<string, Candidate[]>();
  for (let index = 0; index < size; index++) adjacency.set(`contract:${index}`, []);
  for (let index = 0; index < size - 1; index++) {
    const from = `contract:${index}`;
    const to = `contract:${index + 1}`;
    const edge: InternalEdge = {
      index,
      kind: "depends",
      field: "relations.dependsOn",
      fromKey: from,
      toKey: to,
      from: { type: "contract", id: `${index}`, name: `${index}`, title: `${index}` },
      to: {
        type: "contract",
        id: `${index + 1}`,
        name: `${index + 1}`,
        title: `${index + 1}`,
      },
      declaredType: "contract",
      actualType: "contract",
      targetOwners: 1,
    };
    adjacency.get(from)?.push({ edge, next: to, affects: "from", forward: false });
    if (undirected) adjacency.get(to)?.push({ edge, next: from, affects: "from", forward: true });
  }
  return adjacency;
}

describe("cycle pruning depth", () => {
  test("directed SCC discovery handles a deep acyclic graph without recursion", () => {
    expect(directedCycleEdges(chainAdjacency(30_000, false))).toHaveLength(0);
  });

  test("undirected bridge discovery handles a deep tree without recursion", () => {
    expect(undirectedCycleEdges(chainAdjacency(30_000, true))).toHaveLength(0);
  });
});
