---
id: sc-cli-sync-issues
name: a sync that reports source issues exits with code 2 and names the issue
title: Cli Sync Exit Code Two
description: Shows that source issues produce exit code 2 and a named issue.
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
    - cli-sync
---
## Test
a sync that reports source issues exits with code 2 and names the issue
## File
test/cli.test.ts
## What it proves
Shows that source issues produce exit code 2 and a named issue.
## Criteria
cli-sync-exit-code-reflects-issues