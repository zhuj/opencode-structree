---
id: mcp-objects-relations
name: MCP Objects Relations
title: MCP Objects Relations
description: "Reads the relation graph around one object: the edges adjacent to it, and the objects a change to it reaches."
createdAt: 2026-10-22T06:03:50.000Z
updatedAt: 2026-10-22T06:03:50.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - object-facade
  usedBy: []
  commitsTo:
    - adr-answer-impact-questions-from-the-graph
---
## Surface

src/lib/mcp.ts - the objects_relations tool.

## Behavior

Reads the relation graph around one object from the Markdown sources, and returns the edges
adjacent to it in the neighbors mode and the objects a change to it reaches in the impact mode.

## Guarantees
- The root is named by its type and id together, because ids are unique within a type and not across types.
- The impact mode follows the kind of each relation rather than the stored direction of the edge, so a usage relation propagates along the edge and every other kind propagates against it.
- The kind, the distance and the path that reached an object are part of the answer, so a caller can tell a direct dependent from a distant one.
- The link defects the model does not prevent are reported: a dangling target, a target of the wrong type, an ambiguous target and a cycle.
- A link to an object of the wrong type is still followed, so the answer does not lose an edge, and it is reported because the object does not mean what the field declares.
- The graph is read from the sources, so the answer reflects the vault on disk and cannot lag behind the index.
- A finding is reported only when the defect lies within the queried depth, and the findings list is bounded with a total beside it.