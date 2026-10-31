---
id: mcp-repair-filesystem-test
name: mcp-repair-filesystem.test.ts
title: Mcp Repair Filesystem Test
description: Confirms repaired MCP writes reach Markdown and search while refused repairs leave the source untouched.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo: []
  commitsTo:
    - markdown-source-file
    - sqlite-metadata-row
    - interface
---
## File
test/mcp-repair-filesystem.test.ts
## What it covers
repaired MCP writes reach Markdown and search while rejected repairs preserve the source revision
## Verifies
mcp-input-repair-accepted, mcp-input-repair-refused
## Exercises
markdown-source-file, sqlite-metadata-row, interface