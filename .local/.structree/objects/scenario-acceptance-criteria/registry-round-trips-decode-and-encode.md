---
id: registry-round-trips-decode-and-encode
name: registry round trips decode and encode
title: Round-trip decode and encode
description: Encoding a valid object yields canonical JSON and decoding it again yields an equal object.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: registry-registration-validation
  dependsOn:
    - registry-accepts-complete-base-schema
---
## Statement
Round-trip decode and encode: Encoding a valid object yields canonical JSON and decoding it again yields an equal object.
## How it is observed
The encoded JSON parses back to an object equal to the input on every field.