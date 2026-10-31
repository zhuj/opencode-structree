---
id: index-rebuildable
name: Index Is Rebuildable
title: Index Is Rebuildable
description: The whole search index can be discarded and reconstructed from the Markdown sources.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - source-files-authoritative
  commitsTo:
    - adr-sqlite-search-index
    - adr-filesystem-commit-and-reconciliation
---
## Rule
Disposing the SQLite cache file and the model cache MUST NOT lose object data, and startup MUST be able to rebuild the search index from the Markdown sources.
## Evidence
docs/configuration.md:20; docs/library.md:132
## Why it matters
A derived index that can be thrown away is safe to regenerate at any time.