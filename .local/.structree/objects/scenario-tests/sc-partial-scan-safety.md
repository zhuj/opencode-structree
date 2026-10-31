---
id: sc-partial-scan-safety
name: an incomplete snapshot invalidates a confirmed conflict without removing unseen rows
title: Incomplete Snapshot Preserves Rows
description: Shows that an incomplete snapshot removes no row it could not observe.
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
---
## Test
an incomplete snapshot invalidates a confirmed conflict without removing unseen rows
## File
test/vault-sync.test.ts
## What it proves
Shows that an incomplete snapshot removes no row it could not observe.
## Criteria
partial-scan-keeps-unseen-rows