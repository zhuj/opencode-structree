---
id: sc-agent-tool-surface-sweep
name: drives the whole tool surface and leaves the vault as it was found
title: Drives The Whole Tool Surface
description: Shows that an agent can discover, write, read, search, revise and remove objects, and that the vault returns to its starting state.
createdAt: 2026-10-21T08:30:00.000Z
updatedAt: 2026-10-22T06:03:50.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-agent-tool-surface-sweep
  commitsTo:
    - mcp-object-crud-tools
    - mcp-objects-search
    - mcp-objects-relations
    - object-facade
---
## Test
drives the whole tool surface and leaves the vault as it was found
## File
a live MCP session over the official client on 2026-10-21, with test/mcp.test.ts, test/framework.test.ts, test/vault-sync.test.ts, test/sqlite.test.ts and test/relations.test.ts
## What it proves
The sweep created a fifteen-object graph across all twelve registered types, searched it in every mode, revised it against a concurrent writer, deleted it and confirmed that the object counts, the per-type counts and the issue count were exactly what they had been before.
## Criteria
tool-surface-discovery-is-complete, a-write-is-searchable-without-a-resync, each-search-mode-carries-its-own-evidence, a-wrong-checksum-is-refused-like-a-stale-one, immutable-fields-and-id-uniqueness-are-enforced, deletion-is-complete-and-not-repeatable, a-relation-query-names-what-a-change-reaches