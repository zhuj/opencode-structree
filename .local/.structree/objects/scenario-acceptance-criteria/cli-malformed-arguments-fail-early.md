---
id: cli-malformed-arguments-fail-early
name: cli malformed arguments fail early
title: Reject malformed arguments
description: An argument list that is not exactly --config with a filename exits with code 1 before any configuration file is read.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: cli-invalid-usage
  dependsOn:
    - cli-unknown-command-fails
---
## Statement
Reject malformed arguments: An argument list that is not exactly --config with a filename exits with code 1 before any configuration file is read.
## How it is observed
The exit code is 1 and no configuration file in the working directory is read.