---
id: json-config-paths-resolved
name: json config paths resolved
title: Resolve relative paths
description: Relative root, sqlite, model cache and extension paths resolve against the configuration base directory.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: load-json-configuration
  dependsOn: []
---
## Statement
Resolve relative paths: Relative root, sqlite, model cache and extension paths resolve against the configuration base directory.
## How it is observed
The resolved root, sqlite path and cacheDir are absolute paths under the base directory.