---
id: local-state-layout
name: local state
title: Local State Layout
description: Project-local source, cache and configuration layout with a shared user model cache and serve-only default-root/bootstrap behavior.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-31T13:22:25.488Z
retiredAt: null
tags: {}
metadata:
  fileBindings:
    - root: project
      path: src/lib/config.ts
      role: implementation
    - root: project
      path: src/cli.ts
      role: implementation
    - root: project
      path: test/mcp-startup-directory.test.ts
      role: test
relations:
  project: structree-initial
  commitment:
    goals:
      - initial-implementation
---
## Observed Capability

[[projects/structree-initial|Structree]] keeps authoritative objects at the default project-local `objects` root, derived SQLite at `.cache/index.sqlite`, and the optional override at `config.yaml` beneath `.local/.structree`. Model snapshots are the exception: the default is an absolute XDG_CACHE_HOME, or the user's ~/.cache, followed by onnx/models. They are shared across projects rather than stored beneath local state.

The feature supports [[project-goals/initial-implementation|Initial Implementation]] and [[scenarios/default-state-paths|Default State Paths]]. Serve creates local state before loading configuration, exclusively creates an absent .gitignore, and creates a missing source root only when the selected root equals the cwd-relative default. Custom missing roots are not created. Existing gitignore bytes or entries are preserved.

## Source Evidence

- src/lib/config.ts:10,105,144 defines defaults and user-cache resolution.
- src/cli.ts:54 creates state and the gitignore with flag wx; only EEXIST is ignored.
- src/cli.ts:111 creates only the selected exact default source root.
- test/mcp-startup-directory.test.ts:113 records startup, restart, gitignore, custom-root and command-boundary assertions.

## Evidence Limits

Extracted from inspected source. No tests or runtime startup were executed during this extraction. Related model-cache rationale: [[adrs/adr-keep-model-snapshots-in-the-user-cache|Shared User Model Cache]].
