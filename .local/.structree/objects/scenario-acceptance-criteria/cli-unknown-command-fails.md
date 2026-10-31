---
id: cli-unknown-command-fails
name: cli unknown command fails
title: Fail an unknown command
description: An unrecognized command exits with code 1, writes a diagnostic to stderr and writes nothing to stdout.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: cli-invalid-usage
  dependsOn: []
---
## Statement
Fail an unknown command: An unrecognized command exits with code 1, writes a diagnostic to stderr and writes nothing to stdout.
## How it is observed
The exit code is 1, stderr contains the unknown command name and stdout is empty.