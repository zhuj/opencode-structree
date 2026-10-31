---
id: sqlite-test
name: sqlite.test.ts
title: Sqlite Test
description: Validates the real sqlite-vec and FTS5 stack end to end for ranking, fusion, freshness and identity handling.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-21T08:32:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - sc-fts-bm25-order
    - sc-fts-type-filter
    - sc-semantic-freshness
    - sc-chunk-offsets
    - sc-agent-tool-surface-sweep
  commitsTo:
    - sqlite-metadata-row
    - full-text-row
    - embedding-row
---
## File
test/sqlite.test.ts
## What it covers
loads the real sqlite-vec extension and FTS5; literal Unicode queries respect type filters | full-text hits are ranked by BM25 rather than by insertion order | type restriction and distinct-document ranking happen before semantic top-N | hybrid search combines document ranks using configurable reciprocal rank fusion | source edits remove stale vectors atomically and reject late embedding publication | model and dimension changes never mix incompatible vector spaces | rejects malformed or source-mismatched chunks without replacing existing vectors | matched excerpts obey the configured codepoint cap and report their actual offsets | renames preserve vectors; deletions remove metadata; FTS; and vectors; restart preserves issues and generations | a second connection cannot publish a result computed for an earlier checksum | JSON identities preserve distinct lone-surrogate IDs and exact labels across search and reopen | literal FTS expressions reject excessive terms and keep user operators literal | Bun custom-library selection is reused across connections and conflicts are rejected | the lexical encoder ANDs literal tokens and keeps operator words; quotes and asterisks literal | a punctuation-only query yields no tokens and the distinct-token limit fails instead of truncating | both drivers fold case and diacritics and keep the type name out of the indexed text | a lexical hit exposes the matching evidence for body; name; title and frontmatter-only matches | the excerpt obeys the configured code-point cap; splits no astral character; and can disclose a short document whole | a semantic-only hit carries a null excerpt with its chunk unchanged
## Verifies
full-text-bm25-ranking, semantic-cosine-chunk-search, stale-vector-rejection, cache-ownership-and-schema-version, full-text-query-semantics, fulltext-excerpt
## Exercises
sqlite-metadata-row, full-text-row, embedding-row