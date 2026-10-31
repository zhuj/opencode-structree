---
id: cache-state-row
name: Cache State Row
title: Cache State Row
description: The singleton row that carries the monotonic index generation counter.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  usedBy:
    - index-rebuildable
    - sqlite-cache-ownership
  usedIn:
    - sqlite-index-api
    - search-api
    - mcp-objects-status
    - mcp-objects-resync
  commitsTo:
    - adr-sqlite-search-index
    - adr-revision-identity-follows-source-collation
---
## Fields
- singleton
- generation
## Lifecycle
Initialized at zero and incremented on every committed index mutation, and read as the index generation reported to clients.
## Usage
Read by the index status and reported with every search response and resync report.