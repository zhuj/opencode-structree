---
id: adr-local-state-layout
name: Local state layout
title: Local State Layout
description: Authoritative objects, the derived SQLite index and the model cache live under .local/.structree, and no existing object data is migrated when the layout changes.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  commitment:
    scenarios:
      - default-state-paths
      - state-path-isolation-violation
  partOf: null
  dependsOn: []
---
## Context
This decision is recorded in the project's session memory and progress record: the layout section of `.local/.memory/decisions/20261020-144500-configuration-layering.md` and `.local/.progress/2026-10-20-1446-layout-config-yaml.md`. The project kept authoritative objects in `objects/` at the repository root, which was deliberately not git-ignored, so every object file appeared as untracked work, and the derived index and the model cache lived in `.object-mcp/` under a different name and lifecycle. The user asked on 2026-10-20 to keep objects in `.local/.structree/objects`, the database in `.local/.structree/.cache` and for no data migration.

## Decision
The built-in default paths are `root` = `.local/.structree/objects`, `sqlite.path` = `.local/.structree/.cache/index.sqlite` and ONNX `cacheDir` = `.local/.structree/.cache/models`, and the shipped JSON configurations select the same paths explicitly. Because `.local/` is already git-ignored, object data and derived state stop appearing in `git status`. The user made this choice on 2026-10-20 before implementation, and no existing object data was migrated.

## Consequences
- Authoritative objects and derived state now live under one ignored directory, so the working tree stays clean while the objects remain plain Markdown source files.
- Changing the layout never moves existing objects: the legacy `objects/` directory still holds its ten sample objects, unmigrated and untouched, and `.object-mcp/` remains on disk as a leftover until the owner decides.
- The registered MCP command and `objects_status` report the new root and index path, so a server started before the change keeps its old paths until it is rebuilt and reconnected.
- The derived cache under `.local/.structree/.cache/` can be deleted and rebuilt from the authoritative objects, but the objects directory cannot.

## Evidence
- `.local/.memory/decisions/20261020-144500-configuration-layering.md` (layout section)
- `.local/.progress/2026-10-20-1446-layout-config-yaml.md` (acceptance criteria AC1 and AC5, and the report)
- `.local/.memory/operations/opencode-mcp-activation.md` and commit `0d1a5d9`