---
id: sc-mcp-stale-checksum
name: rejects conflicting repairs, unsupported field guesses, and invalid checksum types without mutation
title: Mcp Stale Checksum Rejected
description: Shows that invalid checksums and conflicting arguments fail before any mutation.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-mcp-tool-error-contract
  commitsTo:
    - mcp-object-crud-tools
---
## Test
rejects conflicting repairs; unsupported field guesses; and invalid checksum types without mutation
## File
test/mcp.test.ts
## What it proves
Shows that invalid checksums and conflicting arguments fail before any mutation.
## Criteria
mcp-rejects-stale-checksum, mcp-rejects-invalid-input