---
id: adr-answer-impact-questions-from-the-graph
name: answer impact questions from the relation graph
title: Answer Impact Questions From The Relation Graph
description: The server publishes a relation query that names what a change reaches and what justifies a change, instead of leaving the agent to enumerate whole types and join the relations itself.
createdAt: 2026-10-22T06:03:50.000Z
updatedAt: 2026-10-22T17:04:37.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  commitment:
    scenarios:
      - agent-tool-surface-sweep
  partOf: null
  dependsOn: []
---
## Context

The tool surface could read, write, list and search objects, but it could not answer a question
that crosses a relation. "What breaks if I changed this decision" and "which decisions should I
review if that scenario is changed" both run backwards along the stored relation fields: an ADR
names the scenarios it commits to, so the decisions that rest on a scenario are the records whose
commitment list contains it. No tool could produce that set.

The only way to reach it was to list every type and filter the relation arrays by hand. In the
seeded vault that is twelve list calls and 358 objects, and it has to be redone for every
question. An agent doing it by hand will stop early, and it will not notice that it stopped.

## Decision

The server publishes `objects_relations`, a read-only query over the relation graph. It names one
object and returns the relation edges around it, and, in its impact mode, the objects a change to
it reaches.

Every relation field is classified into a kind, and the kind decides how a change propagates. A
change to the target of a depends, justifies, contains or owns relation reaches the holder; a
change to the holder of a uses relation reaches the target, because a usage relation is stored on
the provider. The organizational kinds and the peer relation do not propagate by default.

The graph is read from the Markdown sources rather than from the derived index, so the answer
reflects the vault on disk and cannot lag behind it. Invalid, unreadable or duplicated source
objects are excluded from the scan, so the query is refused with SOURCE_CONFLICT rather than
answering partially. A dangling or wrong-type link is reported rather than silently dropped; a
wrong-type link is still followed against the target's actual type.

The affected set is breadth-first, so it reports shortest distances. Cycle detection is separate.
Iterative Tarjan strongly-connected components remove edges that cannot belong to a directed
cycle; iterative bridge finding does the same for bidirectional neighbors. Both pruning walks use
explicit heap-backed frames, so graph depth does not consume the native call stack. Directed
cycles share one reverse breadth-first search per reachable start, finding shortest return paths
for its outgoing edges. Bidirectional neighbors use a bounded breadth-first search for each
remaining first edge, excluding that edge from the return path so retracing is not a cycle. This
handles cycles whose shortest paths visit other neighbors first without memoizing a node
independently of its active path. A self-reference is a one-edge cycle.

## Consequences

- A question that crosses a relation has one exact path, and the answer carries the evidence.
- The relation kind becomes a declared property of each type rather than a convention read from
  a field name, and the registry checks each finite declared path against the schema, including
  recursive and suspended schemas.
- The target type is resolved against the objects that exist, so a wrong-type link does not
  remove a real edge from the blast radius; the mismatch is reported because the object does not
  mean what the field declares. The seeded vault carried exactly one such link, and it has been
  corrected.
- A target that names no object is not an object, so it is not in the answer set, while its edge
  and its finding still report the broken link.
- The query reads the whole vault, so its cost grows with the vault. A materialized reverse-edge
  table is the next step if the vault grows by orders of magnitude.
- Search remains the discovery path. It is bounded and nonexhaustive, and a relation id searched
  as text is a heuristic rather than an answer.