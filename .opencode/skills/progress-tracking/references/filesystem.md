# Progress Filesystem Access

## Discover And Inspect

Use the configured Structree source root and registered `work_item` directory.
The included default is `.local/.structree/objects/work-items/`, not
`.local/.progress/`. Tool receipts and trusted configuration identify the actual
path; do not initialize or rewrite configuration just to locate it.

Read visible Markdown sources directly when tools are unavailable or a path is
known. Include subdirectories without depending on routing indexes; do not follow
descendant symlinks, hidden staging names or paths outside the authorized root.
Filter by parsed state/owner, not filename dates. Preserve unreadable, partial,
duplicate or ambiguous sources as diagnostics; do not choose a guessed identity
or reconstruct a next action from invalid display metadata. Readability alone
does not establish a valid work item. Missing storage remains absent on a read.

## Offline Authoring

Prefer progress intent tools while connected. Authorized manual authoring must
produce the current Structree schema, not an old progress template. File names
are `<id>.md`; generate a stable lowercase portable UUID-based ID for new work.
Preserve existing `id`, `name`, `createdAt`, unrelated fields and checkpoint history.
Keep body and evidence unless intentionally revising them. While connected,
prefer `progress_update` for title, outcome, acceptance and body revisions with
an explicit `checkpoint.note`; no full-object update is needed for those fields.
Use actual RFC3339 times, replacing the illustrative dates below.

```yaml
---
id: work-example
name: Example work
title: Example work
description: The bounded outcome being pursued.
createdAt: "2026-11-02T00:00:00Z"
updatedAt: "2026-11-02T00:00:00Z"
retiredAt: null
tags: {}
metadata: {}
outcome: Deliver the agreed observable outcome.
acceptance:
  - A specific check that establishes the outcome
status: planned
nextAction: Inspect the existing implementation and its relevant tests.
blockers: []
verification:
  state: pending
checkpoints: []
relations:
  parent: null
  dependsOn: []
---
```

Follow with a concise Markdown body when scope, rationale, interviews or a
detailed plan need more space. No mandatory fourteen-section template, category
path, timestamped filename or `index.md` is required. Add detail proportionately.
Every nonempty YAML list uses one item per line.

For manual updates, advance `updatedAt` and append a checkpoint instead of
rewriting history. A checkpoint has `note`, actual `recordedAt`, and the current
`verificationState`; an explicit verification change can also be recorded in its
`verification` object. Retain omitted verification and its original recorded time.
Blocked work requires a nonempty blocker list and nonblank next action. Before
recording passed verification, supply actual evidence or a test result and its
recorded time; schema validity alone does not prove this requirement was met.
Preserve parent/dependency IDs and inspect sources for cycles or missing targets.
Manual edits do not run progress-tool graph checks or append history for you.
Record why title, outcome, acceptance or body changes in the new checkpoint.
Changing title does not rename identity or the file, and changing outcome need
not rewrite the separate description. Retain earlier body sections when adding
context; clearing acceptance or body is an explicit content decision. These edits
neither approve the revised plan nor refresh earlier verification.

## Safe Publication And Recovery

Filesystem editors do not automatically share the server's process lock or
checksum guard. A hash check followed by an edit is not atomic compare-and-swap.
Prefer guarded MCP writes when concurrent authors are possible. For manual
writes establish exclusive/coordinated ownership, retain original bytes, recheck
the revision immediately before publication, create without clobbering, and use
available safe atomic replacement for updates. If exclusive ownership or safe
publication cannot be established, retain a proposed change without overwriting
the source. Do not invent a lockfile scheme, steal locks, or stop a server without
permission. Tool denial still applies to equivalent filesystem changes.

Do not fix malformed sources or infer a lifecycle migration as part of a normal
checkpoint. For partial outcomes, retain saved IDs/paths and the failure receipt;
follow an authorized recovery path, not a blind repeat or global rollback.
Deletion, source repair and retirement require their actual scoped authorization.

When available run `objects_validate` after manual edits; otherwise use the
project's available schema validation without starting models or a server.
Unavailable validation means authored-but-unvalidated, not a verified handoff.
For writes affecting dependencies, validate graph meaning separately: a schema
pass does not prove targets, cycles, test execution or acceptance. Read source
files or source-backed list/get results while the index catches up. Do not force
resync, materialization or old helper index refresh as a prerequisite for reading.
