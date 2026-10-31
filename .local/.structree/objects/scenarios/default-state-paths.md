---
id: default-state-paths
name: state paths
title: Default State Paths
description: Resolve project-local state and shared model paths, bootstrap the exact default source root on serve, and preserve existing state and gitignore entries.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-31T13:23:05.301Z
retiredAt: null
tags: {}
metadata: {}
relations:
  project: structree-initial
  partOf: null
  dependsOn: []
  commitment:
    features:
      - local-state-layout
---
## Context

[[projects/structree-initial|Structree]] exposes [[features/local-state-layout|Local State Layout]] with project-local objects, SQLite and overrides, a shared user ONNX model cache, and a coordination lock under the source root.

## Observed Behavior

Serve creates cwd-relative local state before loading config, creates an absent state gitignore exclusively, and creates the configured source root only when it equals the exact cwd-relative default. Custom missing roots are never synthesized. Restart preserves existing state and gitignore entries. Other commands do not inherit the serve-only gitignore bootstrap.

## Criteria

- [[scenario-acceptance-criteria/default-state-paths-under-structree|Project State And Shared Model Paths]]
- [[scenario-acceptance-criteria/state-coordination-lock-location|Coordination Lock Location]]
- [[scenario-acceptance-criteria/serve-bootstraps-only-the-default-source-root|Serve Default Source Bootstrap]]
- [[scenario-acceptance-criteria/serve-creates-missing-gitignore-without-replacing-existing-entries|Preserve Existing Gitignore Entries]]

## Evidence

src/lib/config.ts:105,144; src/cli.ts:54,111; test/mcp-startup-directory.test.ts:113. [[acceptance-tests/acceptance-default-state-paths|Recorded Acceptance Evidence]] describes inspected assertions, not a new execution result.
