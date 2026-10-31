---
id: tolerant-read-tests
name: Tolerant Document Reads Test Suite
title: Tolerant Document Reads Test Suite
description: Source-inspected test evidence for Tolerant Document Reads.
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
  execution: not-run-during-refresh
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - sc-tolerant-document-reads
  commitsTo:
    - partial-document
---
# Tolerant Document Reads Test Suite

Last refreshed: 2026-10-28. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

test/tolerant-reads.test.ts asserts full raw/body retention, controlled YAML diagnostics, safe literal recovery and strict serialization. The test "Vault/FileStore/framework read every recoverable header form without fabricating required fields" in test/tolerant-reads-real.test.ts checks unchanged files, missing invented fields, listing and full-text indexing.

## Traceability

- [[scenario-tests/sc-tolerant-document-reads|sc-tolerant-document-reads]]
- [[entities/partial-document|partial-document]]

## Source Evidence

- implementation: `src/lib/vault/codec.ts`
- implementation: `src/lib/filesystem.ts`
- implementation: `src/lib/types.ts`
- test: `test/tolerant-reads.test.ts`
- test: `test/tolerant-reads-real.test.ts`
- documentation: `README.md`

## Verification Limits

Source and test assertions were inspected. Tests were not run during this documentation refresh. Structural links do not prove runtime behavior or deployment health.
