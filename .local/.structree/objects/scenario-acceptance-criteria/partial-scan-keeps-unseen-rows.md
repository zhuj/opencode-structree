---
id: partial-scan-keeps-unseen-rows
name: partial scan keeps unseen rows
title: Keep unseen rows on a partial scan
description: An incomplete scan removes no cached object that it could not observe.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: partial-scan-preserves-cache
  dependsOn: []
---
## Statement
Keep unseen rows on a partial scan: An incomplete scan removes no cached object that it could not observe.
## How it is observed
The metadata row of the unobserved object is still present after the pass.