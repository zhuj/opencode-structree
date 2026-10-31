---
id: the-scanner-restores-a-name-that-disagrees
name: the scanner restores a name that disagrees
title: The Scanner Restores A Name That Disagrees
description: A discovered file whose name disagrees with its id is renamed to match it, and the indexed path follows.
createdAt: 2026-10-21T09:40:00.000Z
updatedAt: 2026-10-21T09:40:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: vault-file-naming
  dependsOn: []
---
## Statement
The reconciliation renames a discovered file whose base name is not "<id>.md", in the directory it is already in, and updates the indexed path.
## How it is observed
After a file is renamed by hand, the next reconciliation puts it back under its id and the indexed path is the new one. A rename does not trigger a new embedding, because the content did not change.