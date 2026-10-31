---
id: fulltext-excerpt-shows-match-evidence
name: Fulltext Excerpt Shows Match Evidence
title: Fulltext Excerpt Shows Match Evidence
description: Fulltext excerpt shows match evidence
createdAt: 2026-10-21T00:40:00.000Z
updatedAt: 2026-10-21T00:40:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: full-text-bm25-ranking
  dependsOn:
    - fts-ranks-by-bm25
---
## Statement
Fulltext excerpt shows match evidence: A hit with a lexical match carries a bounded excerpt of the indexed text that contains the match.
## How it is observed
The excerpt of a body match contains the matching text, a match that exists only in the YAML frontmatter returns the raw fragment holding the matched value, and a hit without a lexical match carries null.