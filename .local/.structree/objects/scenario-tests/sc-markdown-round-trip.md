---
id: sc-markdown-round-trip
name: round-trips an injected Effect header and exact Markdown body
title: Markdown Round Trip
description: Shows that a header and body survive serialization and parsing unchanged.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-markdown-frontmatter-round-trip
  commitsTo:
    - vault-api
---
## Test
round-trips an injected Effect header and exact Markdown body
## File
test/vault.test.ts
## What it proves
Shows that a header and body survive serialization and parsing unchanged.
## Criteria
markdown-serializes-frontmatter-and-body, markdown-checksum-stable