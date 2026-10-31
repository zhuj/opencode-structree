---
id: sc-cli-unknown-command
name: an unknown command fails with a diagnostic and no standard output
title: Cli Unknown Command Fails
description: Shows that an unknown command exits 1 with a stderr diagnostic and empty stdout.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-cli-invalid-usage
  commitsTo:
    - cli-serve
---
## Test
an unknown command fails with a diagnostic and no standard output
## File
test/cli.test.ts
## What it proves
Shows that an unknown command exits 1 with a stderr diagnostic and empty stdout.
## Criteria
cli-unknown-command-fails