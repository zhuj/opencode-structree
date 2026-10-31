---
id: library-boundary-test
name: library-boundary.test.ts
title: Library Boundary Test
description: Asserts the reusable library stays inside src/lib and still serves a custom schema end to end.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-21T00:50:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo: []
  commitsTo:
    - object-definition
    - interface
    - markdown-source-file
---
## File
test/library-boundary.test.ts
## What it covers
library source imports stay inside src/lib and public reusable entrypoints resolve there | library framework rejects an omitted registry while the application still supplies its core definitions | a separate Notes schema uses the library facade; generated tools; Markdown; and native search | a custom producer that omits the excerpt field stays valid
## Verifies
mcp-crud-tool-round-trip, registry-registration-validation, fulltext-excerpt
## Exercises
object-definition, interface, markdown-source-file