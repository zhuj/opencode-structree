---
id: cache-refuses-unsupported-schema-version
name: cache refuses unsupported schema version
title: Refuse an unsupported schema version
description: Opening a cache whose recorded schema version differs from the supported one throws and names that version.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: cache-ownership-and-schema-version
  dependsOn: []
---
## Statement
Refuse an unsupported schema version: Opening a cache whose recorded schema version differs from the supported one throws and names that version.
## How it is observed
Opening throws an error whose message names the recorded schema version.