---
id: mcp-reports-repair-notices
name: mcp reports repair notices
title: Report repair notices
description: The successful response carries the applied repairs under the object-mcp/input-repair metadata key.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: mcp-input-repair-accepted
  dependsOn:
    - mcp-repairs-malformed-arguments
---
## Statement
Report repair notices: The successful response carries the applied repairs under the object-mcp/input-repair metadata key.
## How it is observed
The response metadata holds a repairs array naming the applied repair categories.