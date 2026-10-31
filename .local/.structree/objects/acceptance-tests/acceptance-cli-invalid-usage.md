---
id: acceptance-cli-invalid-usage
name: cli usage acceptance
title: "Acceptance: Cli Invalid Usage"
description: The scenario cli-invalid-usage is accepted when all of its criteria hold.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - cli-unknown-command-fails
    - cli-malformed-arguments-fail-early
---
## Scenario
cli-invalid-usage - Cli Invalid Usage
## Criteria covered
cli-unknown-command-fails, cli-malformed-arguments-fail-early
## Evidence
test/cli.test.ts