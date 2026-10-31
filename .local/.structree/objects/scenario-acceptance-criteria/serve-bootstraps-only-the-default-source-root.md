---
id: serve-bootstraps-only-the-default-source-root
name: Serve Default State Bootstrap
title: Serve Bootstraps Only The Default Source Root
description: Serve creates local state before config loading and creates the selected source root only if it equals the exact default.
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

In [[scenarios/default-state-paths|Default State Paths]], serve creates cwd-relative .local/.structree before loading configuration. After successful configuration loading it creates the selected root only when it equals the resolved cwd-relative default objects root. Existing custom roots are preserved; missing custom roots are not created. Existing state survives restart, and no config.yaml is synthesized.

## Evidence

src/cli.ts:54-76,111-113; test/mcp-startup-directory.test.ts:114-134,217-249. Help, malformed serve arguments, unknown commands and doctor help return before this bootstrap (test lines 265-272).

Progress provenance: .local/.progress/2026-10-27-0607-mcp-startup-directory.md, also listed completed in the progress index. Test assertions were inspected, not executed in this extraction.
