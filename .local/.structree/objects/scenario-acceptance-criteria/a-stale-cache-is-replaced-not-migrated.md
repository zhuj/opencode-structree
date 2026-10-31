---
id: a-stale-cache-is-replaced-not-migrated
name: a stale cache is replaced not migrated
title: A Stale Cache Is Replaced Not Migrated
description: A cache file from an earlier schema version is refused with a message naming a fresh cache file.
createdAt: 2026-10-21T09:05:00.000Z
updatedAt: 2026-10-21T09:05:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: cache-object-identity
  dependsOn: []
---
## Statement
A cache file written by an earlier schema version is refused when the server opens it, with a message that names a fresh cache file and a resync, and the derived state is rebuilt by the next reconciliation rather than converted.
## How it is observed
Opening a cache file whose recorded version is not the current one fails with that message, and no table is converted in place.