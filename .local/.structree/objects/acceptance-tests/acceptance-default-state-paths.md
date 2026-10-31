---
id: acceptance-default-state-paths
name: state paths acceptance
title: "Acceptance: Default State Paths"
description: Recorded source assertions for default state paths, lock placement, serve bootstrap and exclusive gitignore creation; no execution claim.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-31T13:23:05.301Z
retiredAt: null
tags: {}
metadata:
  fileBindings:
    - root: project
      path: test/config.test.ts
      role: test
    - root: project
      path: test/mcp-startup-directory.test.ts
      role: test
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - default-state-paths-under-structree
    - state-coordination-lock-location
    - serve-bootstraps-only-the-default-source-root
    - serve-creates-missing-gitignore-without-replacing-existing-entries
---
## Scenario

[[scenarios/default-state-paths|Default State Paths]].

## Criteria Covered By Recorded Evidence

- [[scenario-acceptance-criteria/default-state-paths-under-structree|Project State And Shared Model Paths]]
- [[scenario-acceptance-criteria/state-coordination-lock-location|Coordination Lock Location]]
- [[scenario-acceptance-criteria/serve-bootstraps-only-the-default-source-root|Serve Default Source Bootstrap]]
- [[scenario-acceptance-criteria/serve-creates-missing-gitignore-without-replacing-existing-entries|Preserve Existing Gitignore Entries]]

## Evidence And Limits

The existing default-path evidence points to test/config.test.ts. Newly inspected test/mcp-startup-directory.test.ts:114-134 asserts default-root creation and byte preservation; lines 137-215 assert Git exclusions and preservation of custom, empty, symlink and directory gitignore entries; lines 217-249 assert custom-root boundaries and state creation before config failure; lines 252-272 assert command boundaries.

Progress index records prior successful scoped validation in .local/.progress/2026-10-27-0607-mcp-startup-directory.md and .local/.progress/2026-10-27-0645-mcp-startup-gitignore.md. Those are historical reports, not current execution evidence. No tests, builds, model inference, downloads or recovery operations were run for this extraction.
