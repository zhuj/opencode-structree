---
id: sc-duplicate-ids
name: a confirmed duplicate leaves search while an unrelated unseen object survives an incomplete scan
title: Duplicate Ids Excluded
description: Shows that conflicting duplicate identities are reported and excluded from the index.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-partial-scan-preserves-cache
  commitsTo:
    - object-facade
    - sqlite-index-api
---
## Test
a confirmed duplicate leaves search while an unrelated unseen object survives an incomplete scan
## File
test/framework.test.ts
## What it proves
Shows that conflicting duplicate identities are reported and excluded from the index.
## Criteria
duplicate-ids-excluded-from-index