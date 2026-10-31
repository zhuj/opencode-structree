---
id: cache-object-identity
name: cache object identity
title: Cache Object Identity
description: The cache key names an object by its type and id, keeps distinct identities distinct, and is replaced rather than migrated when its shape changes.
createdAt: 2026-10-21T09:05:00.000Z
updatedAt: 2026-10-21T09:05:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  project: structree-initial
  partOf: null
  dependsOn: []
  commitment:
    features:
      - vault-file-object-model
      - sqlite-index-and-search
      - mcp-tool-surface
---
## Scenario

An object is identified in the derived cache by its type and its id joined by a colon. The key is a
readable handle that nothing decodes, two distinct identities never share it, and the exact id of a
row comes from the canonical JSON column rather than from the key.

## Expected behaviour
A key for a plain id reads as the type, a colon and the id. A key for an awkward id carries the JSON
encoding of that id, and the pair is still recoverable. A cache file written by an earlier schema
version is refused with a message naming a fresh cache file, and the next reconciliation rebuilds
the derived state.

## Failure modes
A type containing a colon is refused rather than given an ambiguous identity. An id that differs
only by an unpaired surrogate keeps its own row instead of colliding with the replacement
character.

## Covered by
cache-key-joins-type-and-id, cache-key-keeps-distinct-ids-distinct, exact-id-comes-from-the-json-column, a-stale-cache-is-replaced-not-migrated