---
id: object-identity-key
name: Object Identity Key
title: Object Identity Key
description: An object is identified by its type together with its id.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-21T09:05:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - adr-filesystem-commit-and-reconciliation
    - adr-use-a-type-id-cache-key
---
## Rule
The cache key MUST be the type and the id joined by a colon, with the id part JSON-encoded when the id contains a colon, a double quote, a backslash, a control character or an unpaired UTF-16 surrogate. The type part MUST NOT contain a colon. The same id string MAY be reused in different registered types, and exactly one file MUST provide a given pair for it to be indexed. The framework MUST NOT decode the key: the type comes from the type column and the exact id from the canonical JSON column.
## Evidence
src/lib/filesystem.ts, where the key is built; src/lib/sqlite/index.ts, where the exact id is read from the canonical JSON column; docs/decisions/0012-use-a-type-id-cache-key.md
## Why it matters
A stable identity is what lets a file, an index row and a search hit refer to the same object.