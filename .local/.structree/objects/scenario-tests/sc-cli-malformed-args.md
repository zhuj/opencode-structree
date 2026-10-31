---
id: sc-cli-malformed-args
name: malformed argument lists fail before any configuration is loaded
title: Cli Malformed Arguments Fail
description: Shows that a malformed argument list fails before the configuration file is read.
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
    - config-loader-api
---
## Test
malformed argument lists fail before any configuration is loaded
## File
test/cli.test.ts
## What it proves
Shows that a malformed argument list fails before the configuration file is read.
## Criteria
cli-malformed-arguments-fail-early