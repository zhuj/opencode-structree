---
id: fulltext-excerpt-is-bounded
name: Fulltext Excerpt Is Bounded
title: Fulltext Excerpt Is Bounded
description: Fulltext excerpt is bounded
createdAt: 2026-10-21T00:40:00.000Z
updatedAt: 2026-10-21T00:40:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: full-text-bm25-ranking
  dependsOn:
    - fulltext-excerpt-shows-match-evidence
---
## Statement
Fulltext excerpt is bounded: The native extraction uses a fixed token budget and the published excerpt keeps at most the first search.maxMatchCharacters Unicode code points, without splitting a surrogate pair.
## How it is observed
With a configured limit of five code points the excerpt holds at most five code points and an astral character is not split, and the default limit is 1200 code points.