---
id: object-facade
name: Object Facade
title: Object Facade
description: Defines typed CRUD, source-backed reads, indexed/source search, relations, lifecycle and maintenance delegation.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-28T10:21:37.294Z
retiredAt: null
tags: {}
metadata:
  reviewedHead: 7a507b1b65338daae338ec6c1fb83d5fbff8dfd2
  fileBindings:
    - root: project
      path: src/lib/types.ts
      role: implementation
    - root: project
      path: src/lib/framework.ts
      role: implementation
    - root: project
      path: src/lib/source-access/index.ts
      role: implementation
    - root: project
      path: docs/recovery.md
      role: documentation
relations:
  partOf: null
  dependsOn:
    - object-registry
    - config-loader-api
    - vault-api
    - sqlite-index-api
    - embedding-provider-factory
    - chunking-api
  usedBy:
    - source-files-authoritative
    - object-identity-key
    - id-and-created-at-immutable
    - checksum-guarded-writes
    - create-requires-unused-id
    - duplicate-identity-excluded
    - delete-removes-derived-data
    - concurrent-writes-serialized
    - lock-file-holds-no-object-data
    - atomic-source-publication
    - list-reads-current-files
  commitsTo:
    - adr-filesystem-commit-and-reconciliation
    - adr-extract-library-and-adopt-vault
---
# Object Facade

Last refreshed: 2026-10-28. Stable identity and original creation timestamp retained.

## Current Behavior

The ObjectFacade interface is declared in `src/lib/types.ts`; ObjectFramework implements it in `src/lib/framework.ts`. get/list return validated or partial ReadObject variants with possible assurance qualifiers. Typed writes require complete inputs and latest checksums, preserving ID/createdAt. ObjectFramework search revalidates indexed candidates; the source-access composition may return an honestly labeled source fallback. `relations` is part of the facade. Generic library construction defaults to maintenance and waiting for startup; normal serve instead uses [[interfaces/source-access-runtime-api|Source-access runtime]]. close must drain owned work before disposing resources.

## Typed References

- [[interfaces/object-registry|object-registry]]
- [[interfaces/config-loader-api|config-loader-api]]
- [[interfaces/vault-api|vault-api]]
- [[interfaces/sqlite-index-api|sqlite-index-api]]
- [[interfaces/embedding-provider-factory|embedding-provider-factory]]
- [[interfaces/chunking-api|chunking-api]]
- [[contracts/source-files-authoritative|source-files-authoritative]]
- [[contracts/object-identity-key|object-identity-key]]
- [[contracts/id-and-created-at-immutable|id-and-created-at-immutable]]
- [[contracts/checksum-guarded-writes|checksum-guarded-writes]]
- [[contracts/create-requires-unused-id|create-requires-unused-id]]
- [[contracts/duplicate-identity-excluded|duplicate-identity-excluded]]
- [[contracts/delete-removes-derived-data|delete-removes-derived-data]]
- [[contracts/concurrent-writes-serialized|concurrent-writes-serialized]]
- [[contracts/lock-file-holds-no-object-data|lock-file-holds-no-object-data]]
- [[contracts/atomic-source-publication|atomic-source-publication]]
- [[contracts/list-reads-current-files|list-reads-current-files]]
- [[adrs/adr-filesystem-commit-and-reconciliation|adr-filesystem-commit-and-reconciliation]]
- [[adrs/adr-extract-library-and-adopt-vault|adr-extract-library-and-adopt-vault]]

## Source Evidence

- implementation: `src/lib/types.ts`
- implementation: `src/lib/framework.ts`
- implementation: `src/lib/source-access/index.ts`
- documentation: `docs/recovery.md`

This refresh uses static source evidence; no tests, runtime recovery or model operations were run. Historical decision rationale is not newly invented or retroactively approved.
