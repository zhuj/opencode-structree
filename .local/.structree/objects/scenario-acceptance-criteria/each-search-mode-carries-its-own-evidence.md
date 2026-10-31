---
id: each-search-mode-carries-its-own-evidence
name: each search mode carries its own evidence
title: Each Search Mode Carries Its Own Evidence
description: A fulltext hit carries an excerpt, a semantic hit a distance and a matched chunk, and a hybrid hit both rankings.
createdAt: 2026-10-21T08:30:00.000Z
updatedAt: 2026-10-21T08:30:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: agent-tool-surface-sweep
  dependsOn: []
---
## Statement
Each search mode carries the evidence of the ranking that produced it: a fulltext hit carries a bounded excerpt, a semantic hit carries a distance and a matched chunk, and a hybrid hit carries both rankings.
## How it is observed
A fulltext hit has a non-null `fulltextRank` and a string `fulltextExcerpt`. A semantic hit has a
non-null `semanticDistance` and a `matchedChunk`, and a null `fulltextRank`. A hybrid hit has both,
and its score is the reciprocal rank fusion of the two. The type filter narrows the candidates before
the ranking limit, `types: []` returns no hits without invoking the provider, and `topN` stays inside
its advertised bounds.