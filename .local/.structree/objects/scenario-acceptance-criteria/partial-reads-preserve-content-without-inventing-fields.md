---
id: partial-reads-preserve-content-without-inventing-fields
name: Tolerant Document Reads Observable Boundary
title: Tolerant Document Reads Observable Boundary
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
  scenario: read-and-index-recoverable-markdown
  dependsOn: []
---
# Tolerant Document Reads Observable Boundary

Last refreshed: 2026-10-28. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

Given readable Markdown without a valid complete header, get/list expose partial content and identity provenance without changing source bytes or inventing createdAt/relations. Codec tests retain body/raw for plain and unterminated text and omit ambiguous duplicate/cyclic/non-JSON metadata; real-file tests inspect recoverable forms and full-text discoverability. Tolerant reads are not permission to repair.

## Traceability

- [[scenarios/read-and-index-recoverable-markdown|read-and-index-recoverable-markdown]]

## Source Evidence

- implementation: `src/lib/vault/codec.ts`
- implementation: `src/lib/filesystem.ts`
- implementation: `src/lib/types.ts`
- test: `test/tolerant-reads.test.ts`
- test: `test/tolerant-reads-real.test.ts`
- documentation: `README.md`

## Verification Limits

Source and test assertions were inspected. Tests were not run during this documentation refresh. Structural links do not prove runtime behavior or deployment health.
