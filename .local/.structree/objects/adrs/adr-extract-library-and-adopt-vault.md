---
id: adr-extract-library-and-adopt-vault
name: Extract library and adopt vault
title: Extract Library And Adopt Vault
description: Reusable framework code moves into §src/lib§ with a typed §Vault<Header>§ that composes a confined filesystem with a Markdown codec, while the concrete entity schemas and their default registration stay in the application.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-31T20:42:38.000Z
retiredAt: null
tags: {}
metadata:
  evidences:
    - id: library-boundary-owner-2026-10-31
      kind: owner-decision
      source:
        root: project
        path: .local/.progress/2026-10-31-2018-independent-library-metadata-boundary.md
        locator: Owner Constraint
      description: Owner reinforced that src/lib is generic indexing/RAG/object storage/repository/MCP code, without introduced Structree metadata schemas, types, profile policy or tool composition. Refactor authorized; implementation validation pending.
      recordedAt: 2026-10-31T20:21:19Z
    - id: library-boundary-checks-2026-10-31
      kind: test-result
      source:
        root: project
        path: .local/.progress/2026-10-31-2018-independent-library-metadata-boundary.md
        locator: Final Verification
      description: "Parent ran full project check at the refactored source state: lint/typecheck, 974 pass/2 skip/0 fail, 73-tool stdio smoke, then successful build. Static independent boundary review reported no actionable findings. No real OpenCode/browser tests."
      recordedAt: 2026-10-31T20:42:38Z
  reviews:
    - id: library-boundary-refactor-2026-10-31
      reviewedAt: 2026-10-31T20:42:38Z
      scope:
        - Application metadata moved to src/metadata and src/mcp.ts
        - Generic library source imports, exports and profile-independent MCP composition
        - Application/CLI tool surfaces and guarded metadata behavior
      limitations:
        - Uncommitted working tree; not a clean commit verification
        - Two optional model tests skipped
        - Preexisting library defaults/materialization responsibilities and unrelated staged vault changes outside scope
        - No real OpenCode/browser tests; static reviewer did not execute tests
      workingTree: dirty
  decision:
    status: accepted
    source:
      root: project
      path: docs/decisions/0006-extract-library-and-adopt-vault.md
relations:
  commitment:
    scenarios:
      - vault-confinement-and-size-violations
      - markdown-frontmatter-round-trip
  partOf: null
  dependsOn: []
---
## Context
The prior implementation mixed reusable filesystem and YAML handling with object identity policy in FileStore, and the generic registry and framework factory imported the application's concrete core definitions, so copying storage or generated tools into a similar project carried application schemas and hidden registration defaults along. The supplied storage files demonstrated a useful separation between a vault, confined directories, owned publication stages, document codecs, watcher lifetime and reconciliation, but their facade also embeds node and edge schemas and database-authoritative projection recovery that conflict with this project's filesystem authority. The user asked on 2026-10-19 to adopt the vault and storage ideas without that node and edge model and to move abstract layers into a reusable library.

## Decision
`src/lib` owns the common schemas and contracts, registry, configuration and errors, object facade, generated MCP tools, relaxed input parsing, chunking and providers, database and search abstractions and the new `Vault<Header>`, which composes `ConfinedFilesystem` with `MarkdownCodec<Header>`, while the 12 concrete entity schemas and their default registration stay in the application. The root export still composes the core application and exposes `/lib`, `/vault`, `/sqlite`, `/json-repair` and `/embeddings` as focused package exports. The request was made by the user on 2026-10-19 and is recorded as accepted.

## Consequences
- Similar projects can reuse generic object tools and arbitrary typed Markdown headers without importing core entities, SQLite, MCP or embedding providers.
- Internal source import paths change: direct `ObjectFramework.create()` callers must supply registrations, while the root application factory keeps its defaults.
- Descriptor confinement relies on Linux and procfs, so portable mode has a wider race window and directory durability barriers are best effort where unsupported.
- A second checksum database and a SQLite-stamped TTL read cache are deliberately not introduced, because external file edits can occur without any SQLite change stamp.

## Evidence
- `docs/decisions/0006-extract-library-and-adopt-vault.md` (status accepted, decision-maker "User", dated 2026-10-19)
- `src/lib/index.ts`, `src/lib/vault/vault.ts`, `src/lib/filesystem.ts` and `src/lib/sqlite/process-lock.ts`
- `docs/library.md`, `docs/vault.md` and `test/library-boundary.test.ts`

## Owner Reinforcement: 2026-10-31

The owner explicitly requested moving the introduced Structree-specific metadata schemas, decision/evidence/review types, profile interpretation and tool registration out of `src/lib`. The library is common indexing/RAG/object-storage/repository/MCP infrastructure, not the project domain layer. Application code may depend on the library, never the inverse, including type imports, re-exports, or embedding domain semantics without an import. `src/lib/AGENTS.md` records the boundary.

This reinforces the existing accepted decision, rather than superseding it. The implementation refactor is in progress at this checkpoint; application behavior and library independence still need validation. The exact owner instruction is recorded in the cited project-local progress record. Accepted architecture is not a claim of completed implementation or passing tests.


## Refactor Verification: 2026-10-31

The reinforced boundary is implemented in the current uncommitted tree. Application metadata schemas/types/tools are in `src/metadata/`; `src/mcp.ts` composes them with generic MCP infrastructure. `MetadataObjectDefinition` and profile interpretation are application-owned. Generic `ObjectDefinition` has no metadata profile; `/lib` and `/model` do not export the introduced domain metadata contracts. The shared MCP repair/error/encoding helper remains generic under `src/lib`.

Boundary tests exercise the same core definitions through generic library (65 tools), application (67), and CLI composition (73). The Notes application retains 10 tools. Parent verification passed the full project check (974 passed, 2 skipped, 0 failed, lint/typecheck and stdio smoke), followed by build and model declarations. Independent static review found no actionable findings. Detailed commands, scope and limitations are in the cited progress record. This is current working-tree evidence, not proof for future changes or real OpenCode integration.
