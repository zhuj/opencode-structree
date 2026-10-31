---
id: json-repair-routing-test
name: json-repair-routing.test.ts
title: Json Repair Routing Test
description: Verifies how repaired arguments are routed to nested destination fields and when routing is refused.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - sc-repair-conflict
  commitsTo:
    - interface
    - configuration-layer
    - object-definition
---
## File
test/json-repair-routing.test.ts
## What it covers
rebuilds a missing object wrapper and nested commitments while preserving arbitrary maps | moves mixed owner and commitment fields to their unique enclosing destinations | merges disjoint supplied fragments independently of input property order | rejects duplicate destinations even when values agree and regardless of input order | rejects parent scalars conflicting with supplied descendants in both orders | requires explicit paths when distinct objects share an omitted leaf name | detects ambiguity between normalized direct names and concatenated nested paths | flattens conventional nested paths at several depths with fuzzy matching disabled | accounts for every nested field when flattening rather than dropping unmatched siblings | an enclosing canonical field takes precedence over a local fuzzy spelling guess | preserves identifier bytes; checksum strings and opaque data while wrapping one array value | keeps array elements isolated and never routes a missing leaf across entries | does not synthesize missing required nullable values; arrays; or timestamps | validates repaired unions strictly and rejects unknown fields and divergent candidates | preserves resource-limit failures while exploring recursive union alternatives
## Verifies
mcp-input-repair-accepted, mcp-input-repair-refused
## Exercises
interface, configuration-layer, object-definition