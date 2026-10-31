---
id: cli-invalid-usage
name: cli usage
title: Cli Invalid Usage
description: Rejects an unknown command or a malformed argument list with a diagnostic on stderr and no standard output.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  project: structree-initial
  partOf: null
  dependsOn: []
  commitment:
    features:
      - cli-commands-and-serve
---
## Context
Rejects an unknown command or a malformed argument list with a diagnostic on stderr and no standard output.

## Expected behaviour
A valid command with a valid --config argument starts the requested mode.

## Failure modes
An unknown command or a malformed argument list exits with code 1 and writes nothing to stdout.

## Covered by
cli-unknown-command-fails, cli-malformed-arguments-fail-early