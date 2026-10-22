# Impact analysis: a relation query surface

## Status

Approved design for a new shared tool, `objects_relations`. Not yet implemented.

## The problem

The server exposes 64 tools: `_create`, `_get`, `_update`, `_delete` and `_list`
per object type, plus `objects_search`, `objects_resync`, `objects_status` and
`objects_definitions`. Every one of them operates on a single object or on a
whole type. None of them joins across a relation.

Two questions follow naturally from a graph-shaped vault and cannot be answered
on the current surface:

- **Q1, blast radius.** "What breaks if I changed that decision?" The root is
  an ADR; the answer is every object transitively affected by a change to it.
- **Q2, review set.** "Which decisions should I review if that scenario is
  changed?" The root is a scenario; the answer is the ADRs whose justification
  rests on that scenario, and what those ADRs in turn justify.

Q1 is dominated by propagation. Q2 is dominated by the justification chain. A
single undirected neighbours query conflates them, so the tool classifies every
relation field into a kind with a fixed impact direction.

## The relation model

Twelve types declare 37 relation fields, carrying 1080 edges in the seeded
vault. They fall into six kinds.

| Kind | Fields | Count | Stored as | Impact flows |
| --- | --- | --- | --- | --- |
| `depends` | `dependsOn` on scenario, scenario acceptance criteria, adr, contract, interface, entity, unit test, scenario test, acceptance test | 9 | holder to target | target to holder |
| `justifies` | `commitsTo` on contract, interface, entity, unit test, scenario test, acceptance test; `commitment.scenarios`; `commitment.features`; `commitment.goals` | 9 | holder to target | target to holder |
| `uses` | `interface.usedBy`, `entity.usedBy`, `entity.usedIn` | 3 | provider to consumer | holder to target |
| `contains` | `partOf` on all ten hierarchical types | 10 | child to parent | target to holder (weak) |
| `owns` | `project` on project goal, feature, scenario; `scenario` on scenario acceptance criteria | 4 | child to owner | target to holder (weak) |
| `relates` | `unit_test.relatesTo`, `scenario_test.relatesTo` | 2 | peer to peer | none |

`uses` is the case that breaks naive traversal. `interface.usedBy = [C]` means
C consumes the interface, so a change to the interface breaks C: impact flows
along the stored edge. Every other kind flows against the stored edge. Getting
this backwards silently inverts the blast radius.

`justifies` is what separates Q1 from Q2. A contract that commits to an ADR is
not broken by a change to that ADR; its justification has gone stale and it
must be re-reviewed. `depends` and `uses` are breakage. The tool reports the
kind on every edge so the caller chooses which class it wants.

## The tool

One new shared tool in the `objects_*` family, 65 tools in total.

### Input

```ts
{
  type: string;                    // root type, required
  id: string;                      // root id, required
  mode?: "neighbors" | "impact";   // default "neighbors"
  direction?: "incoming" | "outgoing" | "both";  // neighbors mode only, default "both"
  edgeKinds?: Array<"depends"|"uses"|"justifies"|"contains"|"owns"|"relates">;
  depth?: number;                  // 1..10, default 1
  types?: Array<Type>;             // restrict which object types appear in the result
  includeRetired?: boolean;        // default true
}
```

`type` is required because ids are unique per type, not globally; the model
allows the same id string in two types.

`edgeKinds` defaults to all six kinds in `neighbors` mode and to
`["depends", "uses", "justifies"]` in `impact` mode. `contains` and `owns` are
organizational rather than behavioural, so they do not propagate by default;
`relates` carries no impact at all.

The `direction` argument is rejected in `impact` mode, where the direction
follows from the kind instead.

### Output

```ts
{
  root: { type, id, name, title };
  mode;
  edges: Array<{
    direction: "incoming" | "outgoing";   // direction of the walk that first discovered the edge
    kind: Kind;
    field: string;                        // for example "relations.commitsTo"
    from: { type, id, name, title };
    to: { type, id, name, title };
    distance: number;                     // hops from the root
    affects: "from" | "to" | null;        // impact mode: which endpoint a change propagates to
  }>;
  affected: Array<{                       // the deduplicated answer set
    type, id, name, title, distance, kind,
    via: Array<{ type, id, name, title }>;
  }>;
  findings: Array<{ code, message, edge?, node? }>;
  totalEdges: number;
  truncated: boolean;
  findingsTotal: number;
  findingsTruncated: boolean;
}
```

`edges` is the evidence and `affected` is the answer. In impact mode `affected`
is derived from `edges`, so returning both costs nothing. A node carries its
name and title so the caller can describe the answer without a second read;
the body is not included, because the tool answers a question about the graph
and not about the content.

## Traversal semantics

**Direction.** In `neighbors` mode `direction` selects which way the walk
follows the stored edges: `outgoing` follows `from` to `to`, `incoming` follows
`to` to `from`, and `both` follows either. The `direction` reported for an
edge is the direction of the walk that first reached it, which is the one
nearest the root, so one edge keeps one label and one filter endpoint at every
depth. In `impact` mode the traversal direction is not a parameter; it is
derived from the kind table, and `edgeKinds` narrows which kinds propagate.

**Depth.** `depth` is the maximum hop count. Depth 1 on an ADR in impact mode
returns the five objects that commit to it. Depth 3 returns the 35-object
blast radius. For Q2, depth 1 returns exactly the six ADRs to review, and
depth 2 adds the 26 contracts, interfaces and entities those ADRs justify.
The depth knob is what lets one tool serve both questions.

**Dedupe and distance.** A node is reported once, at its minimum hop distance,
with the path that reached it.

**Cycles.** The object model validates nothing, so a cycle is representable:
`partOf` and `dependsOn` can point at each other. The traversal must terminate.
Cycle detection is separate from the breadth-first walk that computes affected
objects and shortest distances. Iterative Tarjan strongly-connected components
remove edges that cannot belong to a directed cycle; for bidirectional
neighbors, iterative bridge finding removes edges that cannot belong to an
undirected cycle. The pruning walks use explicit heap-backed frames, so their
stack usage does not grow with graph depth. This prevents a dense acyclic graph
from triggering return-path searches.
Directed cycles share one reverse breadth-first search per reachable start,
finding shortest return paths for its outgoing edges. Bidirectional neighbors
use a bounded breadth-first search for each remaining first edge, excluding
that edge from the return path so retracing is not a cycle. Both methods still
find a cycle when shorter paths have already visited its other nodes. A
depth-first search memoized only by remaining depth was rejected because a node
can close a cycle under one active path but not another, and equal-budget paths
can cause exponential re-expansion. The closing edge is reported as a `CYCLE`
finding; a self-reference is a one-edge cycle and is reported at depth one.

**Bounds.** `depth` is hard-capped at 10. The result is capped at 1000 edges
with `truncated: true` and the true `totalEdges`, matching how `objects_status`
reports a bounded issue list with `issuesTotal` and `issuesTruncated`. The
findings list is bounded to 100 entries the same way. Invalid, unreadable or
duplicated source objects are excluded from the scan, so the graph may be
missing an object that exists; the query is refused with `SOURCE_CONFLICT`
rather than answering partially, because a partial answer reads as a complete
one.

**Scope of the findings.** A finding is reported only when the defect lies
within the queried depth. A cycle is reported when its closing edge lies within
the hop budget, so a self-reference is reported at a depth of one.

**Retired objects.** Included by default, consistent with `_list` and
`_search`. A retired object still links, so excluding it by default would hide
real impact. `includeRetired: false` filters them from the answer set while the
walk still passes through them.

**Unresolved targets.** A target that names no object is not an object, so it
is not in the affected set. Its edge is still reported, and the dangling target
is still reported as a finding. The `types` filter classifies such a target by
the type its field declared, so it does not slip past a filter.

**Identifiers.** The root identifier is lowercased like every other read and is
never trimmed, because a stored id may carry surrounding spaces and trimming it
would name a different object.

## Integrity findings

The model deliberately stores unvalidated relation targets, so the tool
surfaces link defects rather than hiding them.

| Code | Meaning | Present in the seeded vault |
| --- | --- | --- |
| `DANGLING_TARGET` | the target id exists in no type | none, of 1080 edges |
| `TARGET_TYPE_MISMATCH` | the target exists, in a different type than the field declares | none, after the correction described below |
| `DUPLICATE_ID` | the root id resolves to several objects of that type | none |
| `AMBIGUOUS_TARGET` | the target id is held by more than one type and the declared type does not hold it | none |
| `CYCLE` | a genuine back-edge, not expanded | none |

The type-mismatch case matters most. A traversal that trusts the declared
target type drops a real link and reports an incomplete blast radius, so the
tool resolves the target's actual type from the vault and flags the
discrepancy. The seeded vault carried exactly one such link, and it is
corrected below.

## Error contract

The tool reuses the established codes and adds none.

| Code | When | Details |
| --- | --- | --- |
| `UNKNOWN_TYPE` | `type`, or a `types` entry, is not registered | `registeredTypes` |
| `VALIDATION` | bad `id`, `depth` out of range, unknown `edgeKinds` value, `direction` passed with `mode: "impact"` | `{}` |
| `NOT_FOUND` | the root id does not exist in that type | `type`, `id` |
| `SOURCE_CONFLICT` | an invalid, unreadable or duplicated source object is excluded from the scan, so the graph may be incomplete | `issues` |
| `DUPLICATE_ID` | the root id resolves to several objects of that type | `type`, `id` |
| `SCAN` | a directory could not be read, so the graph is incomplete | as today |
| `INTERNAL` | unexpected failure | as today |

The tool is read-only, so it cannot raise `CHECKSUM_CONFLICT`,
`ALREADY_EXISTS`, `IMMUTABLE_ID` or `IMMUTABLE_CREATED_AT`.

## Verified behaviour

Computed against the seeded vault with the semantics above.

Q1, `mode: "impact"`, root `adr:adr-flat-search-namespace`, kinds
`["depends", "uses", "justifies"]`:

```
distance 1  contract:search-bounds-enforced        justifies
distance 1  contract:search-hits-revalidated        justifies
distance 1  interface:mcp-objects-search            justifies
distance 1  interface:search-api                    justifies
distance 1  entity:search-hit                       justifies
distance 2  interface:sqlite-index-api              uses
distance 2  interface:agent-skill-structree         depends
distance 2  scenario_test:sc-fts-bm25-order         justifies   (+ 8 more)
distance 3  contract:stale-embeddings-invalidated   uses       (+ 19 more)
```

35 affected objects, no dangling targets, no true cycles, and one
type-mismatch finding on the `sc-fulltext-excerpt-bounded` path.

Q2, `mode: "impact"`, root `scenario:full-text-bm25-ranking`, kinds
`["justifies"]`, depth 1:

```
adr:adr-advertise-effective-bounds-and-bound-status-output
adr:adr-flat-search-namespace
adr:adr-fulltext-search-excerpts
adr:adr-publish-observed-surface-and-reject-empty-identifiers
adr:adr-search-query-and-availability-guidance
adr:adr-sqlite-search-index
```

Six ADRs, no false positives, no findings. At depth 2 the set becomes 32
objects: those six ADRs plus the 26 contracts, interfaces and entities they
justify.

## Search stays

`objects_search` remains the discovery path and is not changed. The new tool
is the exact path for relation questions, and the two are documented as such.
A full-text query on a relation id found every true referrer in ten probes,
but it is capped at 100 hits, is documented as non-exhaustive, and its index
can lag the source, so it is a heuristic rather than an answer.

## Out of scope

- A structured `filter` on the twelve `_list` tools. The relation tool removes
  the need to enumerate whole types for these questions.
- Correcting the type-mismatched link. That was a separate, explicitly scoped
  change to one object, so the tool mechanism and the vault data were
  reviewed independently. It has been applied: `scenario_test.sc-fulltext-excerpt-bounded`
  committed to the entity `full-text-row`, where the field declares an
  interface, and it now commits to the interface `search-api`, which is the
  one that guarantees the bounded excerpt. The vault has no type-mismatched
  link left, so the finding appears in no impact answer.

## Implementation footprint

| File | Change |
| --- | --- |
| `src/lib/types.ts` | the relation kinds, the request and response contracts, and the `ObjectFacade` method |
| `src/registry.ts` | the relation descriptor of each of the twelve types, with the kind that decides impact propagation |
| `src/lib/registry.ts` | a check that a descriptor names a field the schema provides, and that every target type is registered |
| `src/lib/relation-graph.ts` | the graph builder, relation-direction table and adjacency |
| `src/lib/relations.ts` | the breadth-first affected-set walk and findings |
| `src/lib/relation-cycle-pruning.ts` | candidate adjacency and iterative SCC/bridge pruning so acyclic edges do not trigger return-path searches |
| `src/lib/relation-cycles.ts` | bounded shortest-path cycle search, separate from affected-set traversal |
| `src/lib/framework.ts` | the `relations` method: validation, the source scan, the walk and the response |
| `src/lib/mcp.ts` | the input schema, the output schema, the `objects_relations` tool and one `objects_definitions` guidance line |
| `.opencode/skills/structree/SKILL.md`, `references/tool-reference.md` | the tool, plus the two worked examples |
| `test/relations.test.ts`, `test/relations-integrity.test.ts`, `test/relations-regression.test.ts`, `test/relations-limits.test.ts`, `test/relations-declarations.test.ts`, `test/relations-mcp.test.ts`, `test/relation-cycle-pruning.test.ts`, `test/helpers/relations-fixture.ts` | traversal, cycles, identity conflicts, integrity findings, filters, bounds, declarations and the tool surface |

### Why the graph is read from the sources

The first draft of this design proposed a reverse-edge table in the SQLite
index, maintained during reconciliation. The implementation reads the
Markdown sources instead, and the reasons are worth recording:

- The cache schema version is a compatibility break. Adding a table would
  force every deployment to delete its cache and resync, which the project
  reserves for a key encoding change.
- A derived edge table can lag the source, and the tool would then answer
  with a graph that does not match the vault. Reading the sources removes the
  class of problem instead of documenting it.
- The source read is bounded by the vault, and the vault is a knowledge base
  rather than a write-heavy store. The `list` tool already reads a whole type
  from the source for the same reason.

A materialized reverse-edge table remains the right next step if the vault
grows by orders of magnitude. The `object_meta` table already holds the whole
object in its `json` column, and SQLite's `json_each` answers the reverse
lookup exactly, so the change would be local to the index.
