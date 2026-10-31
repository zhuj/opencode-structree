---
id: sc-embedding-rebuild
name: restart reuses unchanged vectors, provider fingerprint changes rebuild them
title: Fingerprint Change Rebuilds Vectors
description: Shows that unchanged vectors are reused while a changed provider fingerprint invalidates them.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-semantic-cosine-chunk-search
  commitsTo:
    - embedding-provider-interface
    - sqlite-index-api
---
## Test
restart reuses unchanged vectors; provider fingerprint changes rebuild them
## File
test/framework.test.ts
## What it proves
Shows that unchanged vectors are reused while a changed provider fingerprint invalidates them.
## Criteria
semantic-honors-freshness-constraints