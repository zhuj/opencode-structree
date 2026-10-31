---
id: search-surface-states-observed-behavior
name: Search Surface States Observed Behavior
title: Search Surface States Observed Behavior
description: The published search descriptions name the error class of a lexical overflow and state the hybrid fallback.
createdAt: 2026-10-21T07:05:00.000Z
updatedAt: 2026-10-21T07:05:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - adr-publish-observed-surface-and-reject-empty-identifiers
---
## Rule

The published search descriptions MUST state the behavior the server actually has.

A query with more than 128 distinct extracted tokens fails with the code `INTERNAL`, not
`VALIDATION`, and the published query description MUST name that code.

In hybrid mode a query with no lexical tokens still runs the semantic ranking. Those hits carry no
lexical evidence: `fulltextRank` is null and `semanticDistance` is set. The published mode
description MUST say so.

The 128-token cap is a self-imposed bound on the generated FTS5 MATCH expression, not a SQLite limit.
On 2026-10-21 SQLite 3.53.4 executed 2000 AND-joined and 5000 OR-joined terms without error. The cap
counts distinct extracted tokens before case and diacritic folding, so case variants count
separately, and it fails rather than truncates.

## Evidence

test/mcp.test.ts, test/sqlite.test.ts, and the live surface on 2026-10-21