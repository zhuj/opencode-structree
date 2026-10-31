---
id: adr-flat-search-namespace
name: Flat search result namespace
title: Flat Search Result Namespace
description: Search results keep source data and computed ranking metadata in separate namespaces, so a host column named after a search field can no longer be overwritten or used for ordering.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-21T08:32:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  commitment:
    scenarios:
      - full-text-bm25-ranking
      - semantic-cosine-chunk-search
      - agent-tool-surface-sweep
  partOf: null
  dependsOn: []
---
## Context
This decision is recorded in the project's session memory in `.local/.memory/lessons/20261019-194600-flat-search-namespace.md`. The reusable SQLite layer supports host-defined tables with arbitrary column names, and before the fix the search projections and the source rows shared one flat namespace, so a legitimate source column named after a search field was replaced by ranking metadata, and a bare `ORDER BY` alias could bind to that column and change which document was returned. The defect was observed on the files at commit `ed94d404` on 2026-10-19 and was fixed on 2026-10-20.

## Decision
The search layer keeps source data and computed ranking metadata in separate namespaces: `FTSRow<Row>` is `{ row: Row; lexical_score: number }` and `VectorSearchRow<Row>` is `{ row: Row; distance: number; chunk_index: number; start_offset: number; end_offset: number; chunk_text: string }`, the FTS projection names the declared source columns explicitly instead of expanding the source wildcard, and the ordering is derived from the BM25 score alone. The fix was applied on 2026-10-20 and verified on both supported SQLite drivers.

## Consequences
- A host column named `distance` or `lexical_score` can no longer be overwritten by ranking metadata, and `ORDER BY` can no longer bind to a source column, so the returned order and the limit-1 document are correct.
- The public result shape changes: `FTSRow` and `VectorSearchRow` expose source values under `row` rather than merged with ranking metadata, which commit `96a3f93` marks as a breaking change.
- The lesson is now a regression guard and must be revalidated after a result-shape change, a new index type, or any change to a search projection.
- A projection that expands a caller-controlled wildcard stays unsafe whenever it also introduces a fixed alias, including the retained extra column that a compatible migration keeps.

## Evidence
- `.local/.memory/lessons/20261019-194600-flat-search-namespace.md`
- `src/lib/sqlite/fts-index.ts`, `src/lib/sqlite/vector-index.ts` and `src/lib/sqlite/table.ts`
- `.local/.progress/2026-10-19-1527-review-2.md`, `.local/.progress/2026-10-19-1527-review-evidence-2.json` and commit `96a3f93`