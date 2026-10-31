---
id: sc-fts-type-text-not-injected
name: Sc Fts Type Text Not Injected
title: Sc Fts Type Text Not Injected
description: A type filter restricts the result without adding the type's words to the indexed text.
createdAt: 2026-10-21T00:20:00.000Z
updatedAt: 2026-10-21T00:20:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-full-text-query-semantics
  commitsTo:
    - search-api
    - mcp-objects-search
---
## Test
type filtering does not inject the type's words into indexed content
## File
test/sqlite.test.ts, test/mcp.test.ts
## What it proves
Shows that a type-filtered query built from the type's own words finds nothing, so the type filter and the query serve different purposes.
## Criteria
fts-type-filter-does-not-inject-type-text