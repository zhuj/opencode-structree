---
id: semantic-honors-freshness-constraints
name: semantic honors freshness constraints
title: Enforce embedding freshness
description: Vector rows whose checksum, fingerprint or dimensions disagree with the source row are excluded from the results.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: semantic-cosine-chunk-search
  dependsOn:
    - semantic-ranks-by-cosine-distance
---
## Statement
Enforce embedding freshness: Vector rows whose checksum, fingerprint or dimensions disagree with the source row are excluded from the results.
## How it is observed
A vector row whose checksum or fingerprint differs from the source row appears in no result set.