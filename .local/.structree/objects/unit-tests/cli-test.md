---
id: cli-test
name: cli.test.ts
title: Cli Test
description: Exercises the CLI as a subprocess for argument handling, status, sync exit codes and YAML diagnostics.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - sc-cli-status
    - sc-cli-sync-issues
    - sc-cli-unknown-command
    - sc-cli-malformed-args
  commitsTo:
    - configuration-layer
    - markdown-source-file
    - sqlite-metadata-row
---
## File
test/cli.test.ts
## What it covers
an unknown command fails with a diagnostic and no standard output | malformed argument lists fail before any configuration is loaded | every help spelling prints the usage and command summary | the status command prints the index; registry; and embedding state as JSON | a sync that reports source issues exits with code 2 and names the issue | a clean sync reports no issues and exits with code 0 | a YAML failure keeps its position and reason without the source value | a duplicate key is reported by position without quoting the key lines
## Verifies
cli-sync-and-status-commands, cli-invalid-usage, markdown-frontmatter-round-trip
## Exercises
configuration-layer, markdown-source-file, sqlite-metadata-row