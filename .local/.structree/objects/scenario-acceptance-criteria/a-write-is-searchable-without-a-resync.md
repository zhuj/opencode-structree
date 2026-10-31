---
id: a-write-is-searchable-without-a-resync
name: a write is searchable without a resync
title: A Write Is Searchable Without A Resync
description: A created object is indexed and embedded on its own, and a resync over unchanged files changes nothing.
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
A created object is searchable and embedded without an explicit resync, and a resync over unchanged files is idempotent.
## How it is observed
After a create, the object is returned by a search and the embedded count has risen with no pending
embedding left. A resync then reports every file scanned as unchanged, nothing indexed and nothing
deleted, and the issue list is empty.