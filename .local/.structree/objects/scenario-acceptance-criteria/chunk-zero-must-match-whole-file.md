---
id: chunk-zero-must-match-whole-file
name: chunk zero must match whole file
title: Require a whole-file chunk zero
description: Chunks whose text does not match their recorded source offsets are refused with an error naming the chunk.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: stale-vector-rejection
  dependsOn: []
---
## Statement
Require a whole-file chunk zero: Chunks whose text does not match their recorded source offsets are refused with an error naming the chunk.
## How it is observed
The call throws an error whose message names the chunk index that does not match its offsets.