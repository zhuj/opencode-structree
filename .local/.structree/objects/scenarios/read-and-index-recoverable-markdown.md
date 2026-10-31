---
id: read-and-index-recoverable-markdown
name: Tolerant Document Reads Workflow
title: Tolerant Document Reads Workflow
description: Observed implementation of Tolerant Document Reads.
createdAt: 2026-10-28T10:18:17.523Z
updatedAt: 2026-10-28T10:18:17.523Z
retiredAt: null
tags:
  basis: observed-implementation
metadata:
  reviewedHead: 7a507b1b65338daae338ec6c1fb83d5fbff8dfd2
  fileBindings:
    - root: project
      path: src/lib/vault/codec.ts
      role: implementation
    - root: project
      path: src/lib/filesystem.ts
      role: implementation
    - root: project
      path: src/lib/types.ts
      role: implementation
    - root: project
      path: test/tolerant-reads.test.ts
      role: test
    - root: project
      path: test/tolerant-reads-real.test.ts
      role: test
    - root: project
      path: README.md
      role: documentation
relations:
  project: structree-initial
  partOf: null
  dependsOn: []
  commitment:
    features:
      - tolerant-document-reads
---
# Tolerant Document Reads Workflow

Last refreshed: 2026-10-28. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

Readable missing, malformed or schema-incomplete frontmatter produces a partial result with original raw text, recoverable JSON metadata, body, checksum and controlled diagnostics. A usable frontmatter id wins; otherwise the filename supplies an explicitly inferred read identity. No missing dates or relations are fabricated. Partial text can be indexed. Strict typed create/update admission remains unchanged; partial-source update/delete is refused rather than treating recovered JSON as lossless source. Confinement, UTF-8 and size limits still apply.

## Traceability

- [[projects/structree-initial|structree-initial]]
- [[features/tolerant-document-reads|tolerant-document-reads]]
- [[scenario-acceptance-criteria/partial-reads-preserve-content-without-inventing-fields|partial-reads-preserve-content-without-inventing-fields]]

## Source Evidence

- implementation: `src/lib/vault/codec.ts`
- implementation: `src/lib/filesystem.ts`
- implementation: `src/lib/types.ts`
- test: `test/tolerant-reads.test.ts`
- test: `test/tolerant-reads-real.test.ts`
- documentation: `README.md`

## Verification Limits

Source and test assertions were inspected. Tests were not run during this documentation refresh. Structural links do not prove runtime behavior or deployment health.
