---
id: adr-schema-registration-base-contract
name: Schema registration base contract
title: Schema Registration Base Contract
description: The registry checks at registration that a schema provides the required base fields the index binds, and the value-integrity walk refuses a non-finite value at any depth.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-21T08:32:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  commitment:
    scenarios:
      - registry-registration-validation
      - invalid-definition-rejected
      - agent-tool-surface-sweep
  partOf: null
  dependsOn: []
---
## Context
This decision is recorded in the project's session memory in `.local/.memory/lessons/20261019-194601-decoded-values-need-finiteness.md`. `ObjectDefinition<A extends BaseObject>` requires `id`, `name`, `title`, `description`, three timestamps, `tags` and `metadata`, but the registry enforced that contract only at the TypeScript level, so a schema omitting `name` was accepted and the object cache then bound `undefined` to a column, making every resync and restart fail with an opaque `INTERNAL` error. The same record refutes an earlier attribution to non-finite decoded values, which is real but separate and much narrower, and notes a depth cutoff that let a nested non-finite value through. The defects were observed at commit `ed94d404` on 2026-10-19 and fixed on 2026-10-20.

## Decision
The registry now checks at registration that a schema provides the required base fields and rejects it with a message naming the missing field, and the value-integrity walk no longer stops at a fixed depth, so a non-finite value is refused at any depth the schema can express with the field path in the message. The coverage analysis understands a union of structs, so a legitimate union is no longer rejected, and a shape it cannot understand is still refused conservatively. The fix was applied on 2026-10-20.

## Consequences
- A registration mistake is reported at the registration boundary with the missing field named, instead of producing a vault that cannot be re-indexed and a service that cannot start.
- A registration the persistence layer cannot represent is refused instead of accepted, which protects the promise that Markdown files stay authoritative and the index is rebuildable.
- The non-finite value policy is enforced at any depth rather than below a silent cutoff, and a traversal bound must report an error instead of returning "not found".
- The 12 shipped core schemas provide every base field, so the defect was reachable only through a host-registered custom type.

## Evidence
- `.local/.memory/lessons/20261019-194601-decoded-values-need-finiteness.md`
- `src/lib/registry.ts`, `src/lib/types.ts`, `src/lib/sqlite/index.ts` and `src/lib/sqlite/filter.ts`
- `.local/.progress/2026-10-19-2005-cross-validation.md` and commit `96a3f93`