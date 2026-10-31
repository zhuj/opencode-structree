---
id: vault-rejects-path-escape
name: vault rejects path escape
title: Reject paths that escape the vault
description: A relative path with parent segments and a symlinked file are both refused with a PATH error.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: vault-confinement-and-size-violations
  dependsOn: []
---
## Statement
Reject paths that escape the vault: A relative path with parent segments and a symlinked file are both refused with a PATH error.
## How it is observed
The call throws a FrameworkError with code PATH and no file is created outside the root.