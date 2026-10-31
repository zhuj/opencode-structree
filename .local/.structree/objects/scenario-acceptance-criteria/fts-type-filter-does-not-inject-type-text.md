---
id: fts-type-filter-does-not-inject-type-text
name: Fts Type Filter Does Not Inject Type Text
title: Fts Type Filter Does Not Inject Type Text
description: The registered type name and directory name are not searchable text, so a type filter is the way to search by kind.
createdAt: 2026-10-21T00:20:00.000Z
updatedAt: 2026-10-21T00:20:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: full-text-bm25-ranking
  dependsOn:
    - fts-respects-type-filter
---
## Statement
Fts type filter does not inject type text: The lexical index covers the object's name, title and raw Markdown document, and it does not add the registered type name or the directory name, so a query built from a type name finds nothing while the type filter still restricts the result.
## How it is observed
An integration search under both SQLite drivers shows that a type-filtered query made of the type's own words returns no candidate, while the same query with a word from an object's content returns it, and the advertised types description says so.