---
id: full-text-row
name: Full Text Row
title: Full Text Row
description: The FTS5 projection of one object used for lexical ranking.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-21T00:45:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - sqlite-metadata-row
  usedBy:
    - index-rebuildable
    - sqlite-cache-ownership
  usedIn:
    - sqlite-index-api
    - sqlite-table-api
    - search-api
    - mcp-objects-search
  commitsTo:
    - adr-sqlite-search-index
    - adr-fulltext-search-excerpts
---
## Fields
- object_key
- name, title, raw

## Lifecycle
Maintained by SQLite triggers on the metadata row so it exists exactly while that row exists. The lexical excerpt is extracted from these columns by the search engine in the same statement that evaluates the match, so the excerpt is current exactly while the row is.

## Usage
Scanned by the lexical ranking path of the search API and the source of the bounded excerpt that a full-text hit carries.