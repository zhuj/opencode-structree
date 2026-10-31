---
id: sc-mcp-repair-accept
name: infers omitted object wrappers and parses stringified nested JSON before strict decoding
title: Mcp Repair Accepts Wrappers
description: Shows that an omitted wrapper and a stringified container are repaired and accepted.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-mcp-input-repair-accepted
  commitsTo:
    - mcp-input-repair-boundary
---
## Test
infers omitted object wrappers and parses stringified nested JSON before strict decoding
## File
test/mcp.test.ts
## What it proves
Shows that an omitted wrapper and a stringified container are repaired and accepted.
## Criteria
mcp-repairs-malformed-arguments