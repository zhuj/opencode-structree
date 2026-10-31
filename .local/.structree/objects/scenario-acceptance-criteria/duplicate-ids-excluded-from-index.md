---
id: duplicate-ids-excluded-from-index
name: duplicate ids excluded from index
title: Exclude duplicate identities
description: Two files sharing one id produce DUPLICATE_ID issues and neither copy is indexed.
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
Exclude duplicate identities: Two files sharing one id produce DUPLICATE_ID issues and neither copy is indexed.
## How it is observed
The report carries two issues with code DUPLICATE_ID and no metadata row exists for that id.