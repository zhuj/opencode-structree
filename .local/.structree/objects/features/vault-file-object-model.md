---
id: vault-file-object-model
name: vault objects
title: Vault File Object Model
description: Stores validated typed Markdown and exposes recoverable partial documents without relaxing guarded mutation.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-28T10:21:37.170Z
retiredAt: null
tags: {}
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
      path: README.md
      role: documentation
    - root: project
      path: docs/recovery.md
      role: documentation
relations:
  project: structree-initial
  commitment:
    goals:
      - initial-implementation
---
# Vault File Object Model

Last refreshed: 2026-10-28. Stable identity and original creation timestamp retained.

## Current Behavior

Validated objects retain complete YAML headers, separate body and whole-source checksum inside confined paths. Readable incomplete/malformed headers are returned as explicit partial documents with original text, recovered JSON fields and identity provenance; missing required values are not invented. Partial text can be searched, but typed update/delete refuses partial sources. Maintenance filename alignment applies only to validated documents; projection and read-only source scans do not repair names. See [[features/tolerant-document-reads|Tolerant reads]] and [[features/explicit-source-repair|Explicit repair]].

## Typed References

- [[projects/structree-initial|structree-initial]]
- [[project-goals/initial-implementation|initial-implementation]]

## Source Evidence

- implementation: `src/lib/vault/codec.ts`
- implementation: `src/lib/filesystem.ts`
- documentation: `README.md`
- documentation: `docs/recovery.md`

This refresh uses static source evidence; no tests, runtime recovery or model operations were run. Historical decision rationale is not newly invented or retroactively approved.
