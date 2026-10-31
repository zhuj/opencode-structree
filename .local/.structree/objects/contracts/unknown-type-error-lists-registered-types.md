---
id: unknown-type-error-lists-registered-types
name: An Unknown Type Error Lists The Registered Types
title: An Unknown Type Error Lists The Registered Types
description: The error that names an unknown type also names the types that exist.
createdAt: 2026-10-20T18:48:18.000Z
updatedAt: 2026-10-20T18:48:18.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - adr-advertise-effective-bounds-and-bound-status-output
---
## Rule
The UNKNOWN_TYPE error MUST carry the registered type names in its details, so the caller can correct the name without another call.

## Evidence
`src/lib/registry.ts` adds the sorted names to the error details.

## Why it matters
The names are the only correction a caller can make, and the search type filter publishes them as an enum as well.