---
id: exact-id-comes-from-the-json-column
name: exact id comes from the json column
title: Exact Id Comes From The Json Column
description: A search hit reports the exact id of the object, including an id a TEXT binding would normalize.
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
The id, name and title of a search hit come from the canonical JSON column, so they are exact even when the id contains an unpaired surrogate.
## How it is observed
A row whose id contains an unpaired surrogate is reported by its search hit with that exact id, and the same holds after the cache is closed and reopened.