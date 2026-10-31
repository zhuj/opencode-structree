---
id: partial-document
name: Partial Document
title: Partial Document
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
  partOf: null
  dependsOn:
    - markdown-source-file
  usedBy:
    - partial-reading-does-not-relax-mutation
  usedIn:
    - partial-document-read-api
  commitsTo: []
---
# Partial Document

Last refreshed: 2026-10-28. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

PartialStoredObject is distinct from a validated StoredObject: partial:true, recovered object, body, raw, checksum, identity and issues. DocumentIdentity distinguishes frontmatter from filename provenance. Recovered fields are not a complete decoded domain instance. Partial search hits omit the dedicated raw property; reduced lists omit body and raw.

## Traceability

- [[contracts/partial-reading-does-not-relax-mutation|partial-reading-does-not-relax-mutation]]
- [[interfaces/partial-document-read-api|partial-document-read-api]]
- [[entities/markdown-source-file|markdown-source-file]]

## Source Evidence

- implementation: `src/lib/vault/codec.ts`
- implementation: `src/lib/filesystem.ts`
- implementation: `src/lib/types.ts`
- test: `test/tolerant-reads.test.ts`
- test: `test/tolerant-reads-real.test.ts`
- documentation: `README.md`

## Verification Limits

Source and test assertions were inspected. Tests were not run during this documentation refresh. Structural links do not prove runtime behavior or deployment health.
