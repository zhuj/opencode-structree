---
id: coordination-lock-file
name: Coordination Lock File
title: Coordination Lock File
description: The dedicated SQLite file that serializes writers across processes on one source root.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  usedBy:
    - concurrent-writes-serialized
    - lock-file-holds-no-object-data
  usedIn:
    - sqlite-process-lock
    - object-facade
    - cli-serve
  commitsTo:
    - adr-database-table-abstractions
    - adr-local-state-layout
---
## Fields
- path
- coordination table
## Lifecycle
Created during store initialization under the source root, held for the lifetime of the process, and closed during shutdown; it never contains object data.
## Usage
Acquired by the object facade around every source mutation through the process lock.