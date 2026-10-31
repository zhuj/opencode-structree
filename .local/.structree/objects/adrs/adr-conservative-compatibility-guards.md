---
id: adr-conservative-compatibility-guards
name: Conservative compatibility guards
title: Conservative Compatibility Guards
description: The cache ownership, uniqueness and FTS layout guards compare only properties the available metadata can express and refuse an incompatible layout instead of accepting it.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  commitment:
    scenarios:
      - cache-ownership-and-schema-version
      - invalid-definition-rejected
  partOf: null
  dependsOn: []
---
## Context
This decision is recorded in the project's session memory in `.local/.memory/lessons/20261019-194602-unique-constraint-semantics.md` and `.local/.memory/lessons/20261020-064500-ownership-check-wildcards.md`. Three guards in the reusable SQLite layer relied on metadata that cannot express the property they need to verify: the cache ownership check used `WHERE name NOT LIKE 'sqlite_%'`, whose underscore is a single-character wildcard, the uniqueness descriptor omitted the `ON CONFLICT` policy because `PRAGMA index_list` and `index_xinfo` expose no such field, and the FTS guard compared columns and tokenizer but not the content model. The defects were observed at commit `ed94d404` on 2026-10-19 and fixed on 2026-10-20.

## Decision
The ownership check matches the literal internal prefix instead of a wildcard pattern, so a database holding only a `sqliteXnotes` table is refused and left unchanged; the migration comparison reads a comment-stripped declaration so a hidden `ON CONFLICT` policy or a changed generated-column expression is detected and refused; and the FTS guard compares the content model and the indexing options, so an external-content, contentless or `UNINDEXED` layout is refused at initialization with a message that requires an explicit rebuild. All three fixes were applied on 2026-10-20.

## Consequences
- A check that cannot express a difference now fails conservatively instead of reporting success and then writing into data the framework does not own or losing a row that was already there.
- The conflict-policy comparison rejects unsupported nondefault policies explicitly and requires an explicit migration, because PRAGMA output can never express that difference.
- The comment-stripping tokenizer change also fixes the shared CHECK-constraint, collation and generated-expression comparisons, and an unterminated block comment becomes a clear migration error.
- The affected tables are host-defined plugin and extension tables rather than the framework's own object cache, whose schema declares no such conflict policy.

## Evidence
- `.local/.memory/lessons/20261019-194602-unique-constraint-semantics.md`
- `.local/.memory/lessons/20261020-064500-ownership-check-wildcards.md`
- `src/lib/sqlite/cache-database.ts`, `src/lib/sqlite/migrator.ts`, `src/lib/sqlite/fts-index.ts` and commit `96a3f93`