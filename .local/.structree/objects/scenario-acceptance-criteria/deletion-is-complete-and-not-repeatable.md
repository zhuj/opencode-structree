---
id: deletion-is-complete-and-not-repeatable
name: deletion is complete and not repeatable
title: Deletion Is Complete And Not Repeatable
description: A delete removes the object and its derived data, and it cannot be repeated.
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
A delete removes the object and its derived search data, and the delete cannot be repeated: deleting the same id again, or deleting an id that never existed, fails with NOT_FOUND.
## How it is observed
The delete returns `deleted: true`. After it, the id is absent from the listing and from the search
results, and the object count returns to the number it had before the object was created.