---
id: config-never-migrates-objects
name: Configuration Never Migrates Objects
title: Configuration Never Migrates Objects
description: Loading or changing configuration never rewrites, renames or migrates stored objects.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - adr-configuration-layering
---
## Rule
Configuration loading MUST NOT write to the source root, rename registered directories or rewrite existing Markdown files, and a configuration change MUST NOT change the stored representation of an object.
## Evidence
src/lib/config.ts:447-475; src/lib/config.ts:284-298; docs/library.md:132-134
## Why it matters
Operators can retune the system without an object migration step.