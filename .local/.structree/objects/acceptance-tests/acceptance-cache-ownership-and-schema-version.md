---
id: acceptance-cache-ownership-and-schema-version
name: cache ownership acceptance
title: "Acceptance: Cache Ownership And Schema Version"
description: The scenario cache-ownership-and-schema-version is accepted when all of its criteria hold.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - cache-refuses-unclaimed-database
    - cache-refuses-unsupported-schema-version
---
## Scenario
cache-ownership-and-schema-version - Cache Ownership And Schema Version
## Criteria covered
cache-refuses-unclaimed-database, cache-refuses-unsupported-schema-version
## Evidence
test/cache-abstraction.test.ts