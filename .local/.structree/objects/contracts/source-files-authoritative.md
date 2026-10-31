---
id: source-files-authoritative
name: Source Files Are Authoritative
title: Source Files Are Authoritative
description: The Markdown files are the single authoritative representation of every object.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - adr-filesystem-commit-and-reconciliation
---
## Rule
The implementation MUST treat the Markdown source as the authoritative copy of an object and MUST treat the SQLite metadata, full-text and embedding rows as rebuildable derived data that never becomes authoritative.
## Evidence
src/lib/sqlite/index.ts:63; src/lib/sqlite/cache-database.ts:208; README.md:3; docs/decisions/0002-sqlite-search.md:45
## Why it matters
A cache can always be regenerated, so a source edit can never be lost to a stale index.