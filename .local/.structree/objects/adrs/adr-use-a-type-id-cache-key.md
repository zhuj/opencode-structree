---
id: adr-use-a-type-id-cache-key
name: use a type id cache key
title: Use A Type Id Cache Key
description: The cache key joins the type and the id with a colon, the id part escaped only when it needs to be, and a stale cache is replaced rather than migrated.
createdAt: 2026-10-21T09:05:00.000Z
updatedAt: 2026-10-21T09:05:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  commitment:
    scenarios:
      - cache-object-identity
      - markdown-frontmatter-round-trip
      - partial-scan-preserves-cache
  partOf: null
  dependsOn:
    - adr-filesystem-commit-and-reconciliation
---
## Context

The cache key identifies an object in the metadata table, is the foreign key of the embedding rows,
joins the full-text table and the vector query, and is also the document key the file scan
produces. It was the JSON encoding of the type and the id pair, which was lossless but stored a
serialized array as the identity and had to be decoded by every reader.

A measurement on 2026-10-21 established why the encoding had to stay lossless: SQLite's UTF-8 TEXT
binding normalizes an unpaired UTF-16 surrogate to the replacement character, so a raw id would let
the distinct ids "id\ud800tail" and "id\ufffdtail" collapse into one cache row and fail the
primary key. The file-backed vault cannot hold such an id, because the vault refuses text
containing an unpaired surrogate, so the guarantee protects the publicly exported reusable library.

## Decision

The key is the type and the id joined by a colon, for example "project:structree-initial".

The type part must not contain a colon. Registered type names are snake_case and never contain
one, so a caller of the public function gets a TypeError rather than an ambiguous key. The id part
is the id used verbatim unless it contains a colon, a double quote, a backslash, a control character
or an unpaired surrogate, in which case the id part is the JSON encoding of the id. A plain id part
never contains a quote, so a JSON-encoded part is recognizable by its leading quote.

The framework never decodes the key. The type comes from the type column and the exact id comes
from the canonical JSON column, which preserves an unpaired surrogate that a TEXT binding would
normalize. The cache schema version moves from 2 to 3, and a cache file from an earlier version is
replaced rather than migrated: the migrator is additive and refuses a changed primary key, and the
derived state is rebuilt by the next reconciliation.

## Consequences

The key is a readable handle and the redundant column stays. The identity guarantee is unchanged:
two distinct type and id pairs still produce distinct keys, and an id that differs only by an
unpaired surrogate stays distinct. A cache file from an earlier version is refused with a message
naming a fresh cache file, so an operator replaces the file and the next synchronization rebuilds
the index and the embeddings.