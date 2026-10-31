---
id: sc-fulltext-excerpt-evidence
name: Sc Fulltext Excerpt Evidence
title: Sc Fulltext Excerpt Evidence
description: Shows that a full-text hit shows why it matched without a separate read.
createdAt: 2026-10-21T00:40:00.000Z
updatedAt: 2026-10-21T00:40:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-fulltext-search-excerpts
  commitsTo:
    - search-api
    - mcp-objects-search
---
## Test
a body match, a name-only match, a title-only match and a frontmatter-only match each expose useful evidence while the body stays omitted
## File
test/sqlite.test.ts, test/framework.test.ts
## What it proves
Shows that a full-text hit shows why it matched without a separate read.
## Criteria
fulltext-excerpt-shows-match-evidence