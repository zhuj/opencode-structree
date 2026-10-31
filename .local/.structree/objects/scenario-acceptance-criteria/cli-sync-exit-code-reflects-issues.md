---
id: cli-sync-exit-code-reflects-issues
name: cli sync exit code reflects issues
title: Set the sync exit code from issues
description: A sync reporting source issues exits with code 2 and names the issue path and code, while a clean sync exits with code 0.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: cli-sync-and-status-commands
  dependsOn: []
---
## Statement
Set the sync exit code from issues: A sync reporting source issues exits with code 2 and names the issue path and code, while a clean sync exits with code 0.
## How it is observed
The process exit code is 2 when issues exist and 0 when the issue list is empty.