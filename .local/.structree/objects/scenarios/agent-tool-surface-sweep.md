---
id: agent-tool-surface-sweep
name: agent tool surface sweep
title: Agent Tool Surface Sweep
description: An agent can discover, write, read, search, revise and remove objects through the tool surface, and every failure it meets arrives as a stated code.
createdAt: 2026-10-21T08:30:00.000Z
updatedAt: 2026-10-22T06:03:50.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  project: structree-initial
  partOf: null
  dependsOn:
    - mcp-crud-tool-round-trip
    - mcp-tool-error-contract
  commitment:
    features:
      - mcp-tool-surface
      - sqlite-index-and-search
      - full-text-search
      - semantic-vector-search
---
## Context
The tool surface was driven end to end against the live server on 2026-10-21, as an agent would use it:
discovery, a fifteen-object graph across all twelve registered types, reading, searching in every mode,
a revision with a concurrent writer, deletion, and a check that the vault was left as it was found.

## Expected behaviour
Every registered type lists, the per-type totals add up to the object count in the status report, a
write is searchable without an explicit resync, each search mode carries the evidence of the ranking
that produced it, and a failure names a code the caller can act on.

## Failure modes
A wrong or stale checksum, a changed immutable field, a taken id, a missing object and a repeated
delete each fail with their own code, and none of them mutates the vault.

## Covered by
tool-surface-discovery-is-complete, a-write-is-searchable-without-a-resync, each-search-mode-carries-its-own-evidence, a-wrong-checksum-is-refused-like-a-stale-one, immutable-fields-and-id-uniqueness-are-enforced, deletion-is-complete-and-not-repeatable, a-relation-query-names-what-a-change-reaches