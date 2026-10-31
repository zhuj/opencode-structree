---
id: cache-key-keeps-distinct-ids-distinct
name: cache key keeps distinct ids distinct
title: Cache Key Keeps Distinct Ids Distinct
description: Two ids that differ only by an unpaired surrogate keep separate cache rows.
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
Two distinct type and id pairs never share a cache key, and the id part is JSON-encoded whenever the id contains a colon, a double quote, a backslash, a control character or an unpaired UTF-16 surrogate.
## How it is observed
Two ids that differ only by an unpaired surrogate and the replacement character produce different keys, and both rows survive a real TEXT binding in the cache. The encoded part parses back to the exact id.