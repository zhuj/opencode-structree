---
id: sc-cache-key-identity
name: keeps distinct object identities in distinct cache rows
title: Keeps Distinct Object Identities
description: Shows that the cache key names an object by its type and id and never lets two identities share a row.
createdAt: 2026-10-21T09:05:00.000Z
updatedAt: 2026-10-21T09:05:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-cache-object-identity
  commitsTo:
    - sqlite-index-api
    - object-registry
---
## Test
keeps distinct object identities in distinct cache rows
## File
test/sqlite.test.ts
## What it proves
Two ids that differ only by an unpaired surrogate and the replacement character keep separate rows, the exact id survives the cache and a reopen, and the key itself is never decoded.
## Criteria
cache-key-joins-type-and-id, cache-key-keeps-distinct-ids-distinct, exact-id-comes-from-the-json-column