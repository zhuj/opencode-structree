---
id: tool-surface-discovery-is-complete
name: tool surface discovery is complete
title: Tool Surface Discovery Is Complete
description: Every registered type lists, the totals add up to the status report, and the report shows no pending embeddings and no issues.
createdAt: 2026-10-21T08:30:00.000Z
updatedAt: 2026-10-21T08:30:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: agent-tool-surface-sweep
  dependsOn: []
---
## Statement
Every registered type lists, the per-type totals sum to the object count in the status report, and the status report carries no pending embeddings and no issues.
## How it is observed
The status report names the driver, the index path, the registered type names, the object count, the embedded count, the pending count and the issue list. The twelve list tools each return a total, and the totals sum to the object count.