---
id: mcp-rejects-stale-checksum
name: mcp rejects stale checksum
title: Reject a stale checksum
description: An update or delete with a checksum that does not match the file returns a structured error with code CHECKSUM_CONFLICT.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: mcp-tool-error-contract
  dependsOn: []
---
## Statement
Reject a stale checksum: An update or delete with a checksum that does not match the file returns a structured error with code CHECKSUM_CONFLICT.
## How it is observed
The structured content carries error.code CHECKSUM_CONFLICT and the file on disk is unchanged.