---
id: serve-creates-missing-gitignore-without-replacing-existing-entries
name: Serve Preserves Existing Gitignore
title: Serve Creates Missing Gitignore Without Replacing Existing Entries
description: Serve exclusively creates an absent state gitignore with cache and lock exclusions and preserves existing bytes or entries.
createdAt: 2026-10-31T13:22:48.420Z
updatedAt: 2026-10-31T13:22:48.420Z
retiredAt: null
tags:
  basis: observed-implementation
metadata:
  fileBindings:
    - root: project
      path: src/cli.ts
      role: implementation
    - root: project
      path: test/mcp-startup-directory.test.ts
      role: test
relations:
  scenario: default-state-paths
  dependsOn: []
---
## Observable Boundary

For [[scenarios/default-state-paths|Default State Paths]], serve attempts exclusive creation of .local/.structree/.gitignore with /cache/, /.cache/, and /objects/.object-mcp-lock.sqlite* rules. EEXIST is ignored, preserving existing custom or empty file bytes, symlinks and directory entries; other errors propagate. The generated rules ignore cache trees and lock sidecars without ignoring object Markdown.

Status, sync and validate do not create this gitignore. This restriction describes gitignore creation, not a guarantee that all non-serve commands perform no filesystem writes.

## Evidence

src/cli.ts:54-71; test/mcp-startup-directory.test.ts:124-126,137-215,252-262.

Progress provenance: .local/.progress/2026-10-27-0645-mcp-startup-gitignore.md, also listed completed in the progress index. Test assertions were inspected, not executed in this extraction.
