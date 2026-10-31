---
id: sqlite-cache-outside-root-enforced
name: sqlite cache outside root enforced
title: Reject a cache inside the object root
description: A sqlite path inside the resolved root raises a CONFIG error stating the cache must be outside the object directory.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: state-path-isolation-violation
  dependsOn:
    - default-state-paths-under-structree
---
## Statement
Reject a cache inside the object root: A sqlite path inside the resolved root raises a CONFIG error stating the cache must be outside the object directory.
## How it is observed
defineConfig throws a CONFIG error whose message states the cache must be outside the object directory.