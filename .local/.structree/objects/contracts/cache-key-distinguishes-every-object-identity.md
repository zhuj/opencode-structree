---
id: cache-key-distinguishes-every-object-identity
name: cache key distinguishes every object identity
title: Cache Key Distinguishes Every Object Identity
description: Two distinct type and id pairs never share a cache key, and the exact id is recoverable without decoding the key.
createdAt: 2026-10-21T09:05:00.000Z
updatedAt: 2026-10-21T09:05:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - adr-use-a-type-id-cache-key
---
## Rule
Two distinct type and id pairs MUST produce distinct cache keys, and the exact id of an object MUST be recoverable from the stored canonical JSON without decoding the key.

A key MUST NOT be produced from a type that contains a colon. The id part MUST be the JSON encoding of the id when the id contains a colon, a double quote, a backslash, a control character or an unpaired UTF-16 surrogate, because a TEXT binding normalizes an unpaired surrogate to the replacement character and would otherwise let two distinct ids collapse into one row.

The framework MUST read the type of a row from its type column and its exact id from its canonical JSON column, and MUST NOT decode the key.

## Why it matters
A cache row that cannot be told apart from another loses one of the two objects, and the loss is silent because the search then returns a single object for two identities. The canonical JSON column is the only place in the cache that preserves an unpaired surrogate exactly.

## Evidence
test/sqlite.test.ts, the identity and label cases for both SQLite drivers; src/lib/vault/utf8.ts, which refuses such text in the file-backed vault