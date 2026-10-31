---
id: search-hits-revalidated
name: Search Hits Are Revalidated
title: Search Hits Are Revalidated
description: A hit is only returned when the file behind it is still current.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-21T00:12:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - adr-sqlite-search-index
    - adr-flat-search-namespace
    - adr-search-query-and-availability-guidance
---
## Rule
Before returning an indexed candidate, the framework MUST reread its source file and compare the raw-source checksum with the indexed checksum. A changed, missing or unreadable source MUST cause the entire hit to be omitted and reconciliation to be requested.

Revalidation MUST filter the already selected candidates without refilling rejected hits to topN.

indexGeneration MUST identify the index snapshot used to select the candidates. It MUST NOT be represented as a snapshot of the current filesystem.

Search MUST be described as bounded and nonexhaustive. An empty result MUST NOT be presented as proof that an object is absent, and passing revalidation MUST NOT be presented as a guarantee against subsequent edits.

Guidance MUST direct known identifiers to the type's get operation and source enumeration to the type's paginated list operation. It MUST NOT require a resync write before a read-only investigation.

## Evidence
`src/lib/framework.ts` `ObjectFramework.search`; `test/framework.test.ts`; the search and status tool descriptions in `src/lib/mcp.ts`

## Why it matters
Search runs on a rebuildable index, so the source file is the final authority on a hit, and a bounded result is not a complete answer.