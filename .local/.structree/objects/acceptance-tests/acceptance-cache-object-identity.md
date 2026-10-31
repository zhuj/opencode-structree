---
id: acceptance-cache-object-identity
name: cache object identity acceptance
title: "Acceptance: Cache Object Identity"
description: The scenario cache-object-identity is accepted when all of its criteria hold.
createdAt: 2026-10-21T09:05:00.000Z
updatedAt: 2026-10-21T09:05:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - cache-key-joins-type-and-id
    - cache-key-keeps-distinct-ids-distinct
    - exact-id-comes-from-the-json-column
    - a-stale-cache-is-replaced-not-migrated
---
## Scenario
cache-object-identity - Cache Object Identity
## Criteria covered
cache-key-joins-type-and-id, cache-key-keeps-distinct-ids-distinct, exact-id-comes-from-the-json-column, a-stale-cache-is-replaced-not-migrated
## Evidence
test/sqlite.test.ts, src/lib/sqlite/cache-database.ts, docs/decisions/0012-use-a-type-id-cache-key.md