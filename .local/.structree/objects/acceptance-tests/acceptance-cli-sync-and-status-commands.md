---
id: acceptance-cli-sync-and-status-commands
name: cli commands acceptance
title: "Acceptance: Cli Sync And Status Commands"
description: The scenario cli-sync-and-status-commands is accepted when all of its criteria hold.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - cli-status-prints-json-state
    - cli-sync-exit-code-reflects-issues
---
## Scenario
cli-sync-and-status-commands - Cli Sync And Status Commands
## Criteria covered
cli-status-prints-json-state, cli-sync-exit-code-reflects-issues
## Evidence
test/cli.test.ts