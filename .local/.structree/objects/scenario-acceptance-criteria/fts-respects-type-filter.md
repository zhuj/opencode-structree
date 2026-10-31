---
id: fts-respects-type-filter
name: fts respects type filter
title: Apply the type filter
description: Restricting a search to one type excludes every hit of any other type from the result.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: full-text-bm25-ranking
  dependsOn:
    - fts-ranks-by-bm25
---
## Statement
Apply the type filter: Restricting a search to one type excludes every hit of any other type from the result.
## How it is observed
Every returned hit carries the requested object type and no hit of another type is present.