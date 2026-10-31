---
id: cache-ownership-and-schema-version
name: cache ownership
title: Cache Ownership And Schema Version
description: Refuses to open a SQLite file that belongs to another application, is unclaimed, or carries an unsupported schema version.
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
      - sqlite-index-and-search
---
## Context
Refuses to open a SQLite file that belongs to another application, is unclaimed, or carries an unsupported schema version.

## Expected behaviour
A fresh or previously owned cache file opens, initializes its tables and records its schema version.

## Failure modes
A foreign, unclaimed or version-incompatible file is refused without altering it.

## Covered by
cache-refuses-unclaimed-database, cache-refuses-unsupported-schema-version