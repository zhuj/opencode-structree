---
id: acceptance-agent-tool-surface-sweep
name: agent tool surface sweep acceptance
title: "Acceptance: Agent Tool Surface Sweep"
description: The scenario agent-tool-surface-sweep is accepted when all of its criteria hold.
createdAt: 2026-10-21T08:30:00.000Z
updatedAt: 2026-10-22T06:03:50.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - tool-surface-discovery-is-complete
    - a-write-is-searchable-without-a-resync
    - each-search-mode-carries-its-own-evidence
    - a-wrong-checksum-is-refused-like-a-stale-one
    - immutable-fields-and-id-uniqueness-are-enforced
    - deletion-is-complete-and-not-repeatable
    - a-relation-query-names-what-a-change-reaches
---
## Scenario
agent-tool-surface-sweep - Agent Tool Surface Sweep
## Criteria covered
tool-surface-discovery-is-complete, a-write-is-searchable-without-a-resync, each-search-mode-carries-its-own-evidence, a-wrong-checksum-is-refused-like-a-stale-one, immutable-fields-and-id-uniqueness-are-enforced, deletion-is-complete-and-not-repeatable, a-relation-query-names-what-a-change-reaches
## Evidence
test/mcp.test.ts, test/framework.test.ts, test/vault-sync.test.ts, test/sqlite.test.ts, test/relations.test.ts, and a live MCP session on 2026-10-21