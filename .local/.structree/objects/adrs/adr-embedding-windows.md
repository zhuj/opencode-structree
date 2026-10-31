---
id: adr-embedding-windows
name: Embedding windows
title: Embedding Windows
description: An over-context input is represented as a normalized weighted mean of embeddings for complete, disjoint windows, with the whole-file vector kept at chunk index zero and separate overlapping retrieval chunks at positive indices.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  commitment:
    scenarios:
      - openai-embedding-request
      - semantic-cosine-chunk-search
  partOf: null
  dependsOn: []
---
## Context
Valid Markdown files can contain more text than the selected local encoder accepts, and the user required a whole-file embedding at index zero plus positive part rows with 10% intersection between adjacent parts, so an overflow policy was required. The default multilingual E5 model uses a 512-token context and the OpenAI embeddings API documents a per-input token limit as well as request-level limits, so a larger model cannot remove the need for a defined policy. The record is dated 2026-10-18.

## Decision
The framework represents an over-context input as a normalized weighted mean of embeddings for complete, disjoint internal windows, keeps the whole-file representation at chunk index zero, and stores separate overlapping retrieval chunks at positive indices, defaulting to 1,200 code points with 120 shared code points and half-open Unicode code-point offsets. The provider fingerprint carries model identity, dimensions, prefixes, context and window policy, normalization and aggregation version, so a change invalidates only derived data. The record, dated 2026-10-18, is implemented and remains proposed.

## Consequences
- Every successfully indexed file contributes all of its content, including text after the first model context window, so long files keep semantic coverage without a new source format.
- A weighted mean is an approximation that cannot reproduce attention across distant windows, and code-point boundaries can divide words, sentences or grapheme clusters.
- Whole-file windows and retrieval chunks embed overlapping content separately, which consumes additional CPU time or API tokens compared with indexing parts alone.
- Byte-based OpenAI windows can underuse the available token context, favouring safe input coverage over maximum request density.

## Evidence
- `docs/decisions/0003-embedding-windows.md`
- `src/lib/chunking.ts`, `src/lib/embeddings/onnx.ts` and `src/lib/embeddings/openai.ts`
- `test/embeddings.test.ts` and `test/chunking.test.ts` (16 tests, 91 assertions) and `test/onnx-integration.test.ts` (1 test, 36 assertions), recorded on 2026-10-18