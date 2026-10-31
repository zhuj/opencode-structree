---
id: sc-cli-status
name: the status command prints the index, registry, and embedding state as JSON
title: Cli Status Prints Json
description: Shows that the status command emits parseable JSON and exits with code 0.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-cli-sync-and-status-commands
  commitsTo:
    - cli-status
---
## Test
the status command prints the index; registry; and embedding state as JSON
## File
test/cli.test.ts
## What it proves
Shows that the status command emits parseable JSON and exits with code 0.
## Criteria
cli-status-prints-json-state