# Memory Filesystem Access

## Locate And Read

Discover the configured Structree source root and the registered memory
directory from trusted project configuration, `objects_definitions`, or an
existing tool receipt. The included default is
`.local/.structree/objects/memories/`. Do not create or modify configuration to
make this path exist. No routing `index.md` or category directory is required.

Read trusted source files directly when tools are unavailable or a path is
already known. Enumerate visible Markdown sources, including subdirectories,
without following descendant symlinks or escaping the selected root. Filesystem
discovery excludes hidden names; missing indexes do not hide records. Parse
frontmatter separately from body and distinguish malformed/ambiguous identity
from valid knowledge. Readability is not source validity or current guidance.
Do not pick one conflicting duplicate ID or treat a filename as verified identity.

## Author The Same Record

Prefer `memory_remember/revise` for normal writes: they provide mechanical
bookkeeping, validation and guarded publication. Authorized offline authoring
must produce a complete Structree object, not the legacy memory format. Use
`<id>.md` with a stable lowercase portable ID, UUID-based when creating anew.
Preserve `id` and `createdAt` on updates; use real RFC3339 timestamps, not the
illustrative dates below. A different filename is not a supported ID rename.

```yaml
---
id: memory-example
name: Example finding
title: Example finding
description: Short reusable conclusion and applicability.
createdAt: "2026-11-02T00:00:00Z"
updatedAt: "2026-11-02T00:00:00Z"
retiredAt: null
tags: {}
metadata: {}
category: lessons
status: draft
confidence: low
scope:
  - A specific subsystem or situation
labels:
  - topic
relations:
  buildsOn: []
  supersedes: []
  contradicts: []
  relatedTo: []
  implements: []
  constrains: []
  motivatedBy: []
  validatedBy: []
---
```

Follow the header with Markdown describing the finding, evidence/basis, scope,
uncertainty and freshness. Optional structured `evidences`, `fileBindings` and
`reviews` must follow current schemas; do not infer them from arbitrary metadata.
Use one item per line for every nonempty YAML list. These are Structree fields:
legacy `summary`, `tags` arrays, `created`, `review_after` and path categories
are not silently migrated by writing them here.

## Concurrent Writes And Validation

An ordinary editor does not participate in the server's SQLite process lock.
Rereading or checking a hash before a write reduces stale-edit risk but does not
make that write an atomic compare-and-swap. Prefer MCP writes while the server or
another author may change the same file. For authorized manual writes, establish
exclusive/coordinated ownership first; if that cannot be established, retain the
proposed change without publishing it. Do not invent a lockfile protocol, steal
a server lock, or stop another writer without permission.

Under exclusive ownership, retain the original bytes, recheck the revision before
publication, preserve unrelated fields/body/evidence, create without clobbering,
and use an available safe atomic replacement for updates. If the available file
tool cannot meet the required guarantee, use the guarded tool or report the
blocker. Never repair partial or ambiguous sources implicitly through a rewrite.

Use `objects_validate` after manual authoring when connected, or the project's
available schema validation without starting models or a server. If validation
is unavailable, report the file as authored but unvalidated, not valid guidance.
External writes can outpace the derived index: read the source or fully paginate
`memory_list` rather than forcing resync. Source validation does not establish
retrieval freshness or truth. Resync/repair/materialization writes require their
own authorization; do not run old `memory_refresh` or helper synchronization.
