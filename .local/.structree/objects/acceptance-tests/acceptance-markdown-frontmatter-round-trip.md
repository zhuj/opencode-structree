---
id: acceptance-markdown-frontmatter-round-trip
name: markdown round trip acceptance
title: "Acceptance: Markdown Frontmatter Round Trip"
description: The scenario markdown-frontmatter-round-trip is accepted when all of its criteria hold.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - markdown-serializes-frontmatter-and-body
    - markdown-checksum-stable
---
## Scenario
markdown-frontmatter-round-trip - Markdown Frontmatter Round Trip
## Criteria covered
markdown-serializes-frontmatter-and-body, markdown-checksum-stable
## Evidence
test/framework.test.ts, test/vault.test.ts