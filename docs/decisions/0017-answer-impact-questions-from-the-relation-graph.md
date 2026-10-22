---
status: accepted
date: "2026-10-22"
decision-makers:
  - User
consulted: []
informed: []
supersedes: []
superseded-by: []
---

# 0017. Answer impact questions from the relation graph

## Decision summary

Publish a read-only relation query that names what a change reaches and what
justifies a change. Classify every relation field into a kind that decides how
a change propagates along it, read the graph from the Markdown sources rather
than the derived index, and report the link defects the object model does not
prevent.

## Context and problem statement

The tool surface could read, write, list and search objects, but it could not
answer a question that crosses a relation. The vault is a graph: an ADR names
the scenarios it commits to, a contract names the decisions that justify it, a
scenario test names the interface it exercises. Two questions follow from that
shape and neither had a path to an answer:

- what breaks if this decision changes, which is the set of objects that
  reference it and the objects that reference those;
- which decisions should I review if this scenario changes, which is the set
  of ADRs whose commitment list names the scenario.

Both run backwards along the stored relation fields. A decision names the
scenarios it commits to, so the decisions that rest on a scenario are the
records whose commitment list contains it. No tool could produce that set.

The only way to reach it was to list every type and filter the relation arrays
by hand: twelve list calls and 358 objects in the seeded vault, redone for
every question. An agent doing that by hand stops early without noticing, and
a partial answer is worse than no answer because it reads as complete.

The stored fields are not enough to interpret the graph either. A `commitsTo`
field means the holder is justified by its target, so a change to the target
reaches the holder. A `usedBy` field means the target consumes the holder, so
a change to the holder reaches the target. The two point in opposite
directions along the stored edge, and a traversal that assumes one convention
silently inverts the answer.

## Decision drivers

- Give a question that crosses a relation one exact path, with the evidence
  attached, instead of leaving the join to the caller.
- Keep the answer honest about the graph: report the link defects rather than
  hiding them, and do not drop an edge because it contradicts the schema.
- Do not let the answer depend on a derived index that can lag the source.
- Make the propagation direction an explicit property of the object model
  rather than a convention read from a field name.
- Keep the cost of the query proportional to the vault it reads.

## Considered options

1. **Keep enumeration and let the caller join.** Rejected. It makes the
   caller do the part of the work that is easiest to get wrong, and the
   failure is silent: a short answer that looks complete.
2. **Add a filter to the twelve list tools instead of a new tool.** Rejected
   for this change. It spreads the same capability across twelve input
   schemas, and it answers "which objects of this type link to X" rather than
   the question that was asked, which is what a change reaches.
3. **Search for the relation id as text.** Rejected as the answer, kept as
   the discovery path. It is bounded, nonexhaustive, and its index can lag.
   A full-text query on a relation id did find every true referrer in the
   seeded vault, but it finds them by token overlap, so it also returns
   documents that merely mention the id.
4. **One tool with two modes.** Selected. The neighbors mode returns the
   edges adjacent to an object and the impact mode returns the objects a
   change to it reaches. One tool with one description keeps the surface at
   65 tools, and the two modes share the kind table and the graph builder.

## Decision outcome

The server publishes `objects_relations`. It takes the type and id of a root
object, a mode, and optionally a direction, a set of relation kinds, a depth,
a type filter and a retired-object filter.

Each registered type declares its relation fields, and each field carries a
kind. The kind decides how a change propagates:

| Kind | A change to the target reaches the holder | A change to the holder reaches the target |
| --- | --- | --- |
| `depends` | yes | no |
| `justifies` | yes | no |
| `uses` | no | yes |
| `contains` | yes | no |
| `owns` | yes | no |
| `relates` | no | no |

A `uses` relation is stored on the provider, so it is the only kind whose
impact runs along the stored edge. The organizational kinds and the peer
relation do not propagate by default, so the impact mode propagates `depends`,
`uses` and `justifies` unless the caller asks for more.

The graph is read from the Markdown sources, not from the derived index, so
the answer reflects the vault on disk and cannot lag behind it. The registry
refuses a relation descriptor that names a field the schema does not provide,
and refuses a descriptor whose target type is not registered, so a mistake in
the declaration is reported at startup rather than as a mysteriously empty
answer.

The affected-set walk is breadth-first, so an object is reported once at its
shortest distance. Cycle detection is separate. Iterative Tarjan
strongly-connected components remove edges that cannot belong to a directed
cycle; iterative bridge finding does the same for bidirectional neighbors.
Both pruning walks use explicit heap-backed frames, so graph depth does not
consume the native call stack. This prevents dense acyclic graphs from
triggering return-path searches. Directed cycles share one reverse
breadth-first search per reachable start, finding shortest return paths for
its outgoing edges. Bidirectional neighbors use a bounded breadth-first search
for each remaining first edge, excluding that edge from the return path so
retracing is not a cycle. Both methods still find a cycle when shorter paths
have already visited its other nodes. A self-reference is a one-edge cycle,
reported at depth one.

A depth-first search memoized only by remaining budget was rejected. A node can
close a cycle under one active path but not another, so that memo can miss
cycles; allowing equal-budget re-expansion without the active-path condition
also causes exponential work in a wide graph. The bounded shortest-path search
is polynomial in the reachable graph and keeps cycle findings separate from
the affected set.

The response carries the edges with their kind, field, direction, distance and
affected endpoint, the affected set with the path that reached each object,
and the findings. The findings report the link defects the model does not
prevent, because the framework stores relation targets as written and never
checks them: a dangling target, a target of the wrong type, an ambiguous
target, and a cycle. A link to a target of the wrong type is still followed,
so the answer does not lose an edge, and it is reported because the object
does not mean what the field declares. The seeded vault carried exactly one
such link, and it has been corrected: the scenario test
`sc-fulltext-excerpt-bounded` committed to the entity `full-text-row` where
the field declares an interface, and it now commits to the interface
`search-api`, which is the one that guarantees the bounded excerpt.

A finding is reported only when the defect lies within the queried depth, and
the findings list is bounded with a total beside it, in the way
`objects_status` bounds its issue list. A target that names no object is not
an object, so it is not in the affected set, while its edge and its finding
still report the broken link.

An invalid, unreadable or duplicated source object is excluded from the scan,
so the graph may be missing an object that exists. The query is refused with
`SOURCE_CONFLICT` rather than answering partially, because a partial answer
reads as a complete one.

## Consequences

### Positive

- A question that crosses a relation has one exact path, and the answer
  carries the kind, the distance and the path that reached each object.
- The propagation direction is a declared property of the object model, so it
  is checked rather than assumed.
- A link that contradicts the schema is reported instead of silently dropped,
  and the blast radius stays complete.
- The answer is never stale relative to the files on disk.

### Negative

- The query reads the whole vault, so its cost grows with the vault. The
  seeded vault is 358 objects and the query is fast; a vault two orders of
  magnitude larger would need the materialized reverse-edge table described
  below.
- The tool surface grows by one tool, and an agent now has two ways to reach
  a relation: the exact query and the search heuristic. The guidance names
  the query as the answer and the search as the discovery path.
- A relation kind is a design decision, not a derivable property, so the
  declaration is duplicated next to the schema. The registry checks the
  declaration against the schema, which keeps the two from drifting.

### Follow-up

The `object_meta` table already holds the whole object in its `json` column,
and SQLite's `json_each` answers the reverse lookup exactly, so a
materialized reverse-edge table is a local change to the index. It is the
right next step if the vault grows by orders of magnitude. It is deliberately
not part of this decision, because adding a table to the cache is a
compatibility break: the cache schema version is a break by design, and this
change does not warrant forcing every deployment to delete its cache.

## Confirmation

 `test/relations.test.ts`, `test/relations-integrity.test.ts`,
 `test/relations-regression.test.ts`, `test/relations-limits.test.ts`,
`test/relations-declarations.test.ts`, `test/relations-mcp.test.ts` and
`test/relation-cycle-pruning.test.ts` cover
 traversal, propagation direction, cycles and diamonds, identity conflicts,
 integrity findings, filters, bounds, every relation descriptor, top-level and
 suspended unions, and the MCP surface. Regression tests cover retracing one
 edge, stable edge direction/filter endpoint, spaced identifiers, unresolved
 targets, cycles with varying active paths and a triangle whose shortest paths
 visit all neighbors first, self-cycles, cycle-search performance on a wide
 graph, traversal through excluded types and retired objects. The live vault
 was queried end to end after the change: a change to
`adr-flat-search-namespace` reaches 35 objects, and a change to the scenario
`full-text-bm25-ranking` names the six decisions that rest on it.

## Links

- [The impact-analysis proposal](../impact-analysis-proposal.md).
- [Published MCP tools](../../src/lib/mcp.ts).
- [The relation graph traversal](../../src/lib/relations.ts).
- [Graph construction and edge direction](../../src/lib/relation-graph.ts).
- [Cycle edge pruning](../../src/lib/relation-cycle-pruning.ts).
- [Bounded cycle detection](../../src/lib/relation-cycles.ts).
- [The relation declarations](../../src/registry.ts).
- [Agent tool surface sweep](../../.local/.structree/objects/scenarios/agent-tool-surface-sweep.md).
- [Filesystem commit and reconciliation](0001-filesystem-commit-and-reconciliation.md).
- [Search query and availability guidance](0008-search-query-and-availability-guidance.md).
