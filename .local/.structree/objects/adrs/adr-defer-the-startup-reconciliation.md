---
id: adr-defer-the-startup-reconciliation
name: defer the startup reconciliation
title: Defer The Startup Reconciliation
description: The MCP server starts its first reconciliation in the background and answers while the index is being built; the diagnostic command still waits for a completed pass.
createdAt: 2026-10-21T11:20:00.000Z
updatedAt: 2026-10-28T10:22:56.351Z
retiredAt: null
tags: {}
metadata:
  reviewedHead: 7a507b1b65338daae338ec6c1fb83d5fbff8dfd2
  fileBindings:
    - root: project
      path: src/cli.ts
      role: implementation
    - root: project
      path: src/lib/resilient-runtime.ts
      role: implementation
    - root: project
      path: src/lib/source-access/index.ts
      role: implementation
    - root: project
      path: docs/decisions/0015-defer-the-startup-reconciliation.md
      role: documentation
    - root: project
      path: docs/recovery.md
      role: documentation
relations:
  commitment:
    scenarios:
      - resync-index-reconciliation
  partOf: null
  dependsOn:
    - adr-filesystem-commit-and-reconciliation
---
## Context

The server waited for its first reconciliation before answering any request, so a large vault made
the startup as slow as the scan. The first pass is also what indexes the existing Markdown files and
what renames a file whose name disagrees with the id inside it, so delaying it delays the first
useful answer.

## Decision

The MCP server begins the startup reconciliation and does not wait for it. The library's default is
unchanged: a caller that creates a framework without asking for the deferral still waits for the
first pass. The diagnostic command waits, so the report it prints describes a completed pass.

A failure of the deferred startup is delivered through the framework's error channel, does not stop
the server, and is still visible to a caller that waits for the startup. The status report tells the
truth while the pass runs: it reports that a synchronization is in progress and that no completed
report exists yet.

A create indexes its own object immediately, so a create followed by a search works while the
background pass runs. What is not yet indexed is everything the pass has not reached, and the
published search description says so.

## Consequences

A search issued right after the server starts may find nothing, and the published description states
that. The status tool is the way to learn whether the index is ready. The rename of a file whose
name disagrees with its id happens in the background, after the server has already begun answering.

## Current Implementation Qualification (2026-10-28)

The historical decision above remains its recorded rationale. Later source-first serving admits source get/list before optional readiness, uses projection reconciliation without source renames/embedding jobs, and can report honestly degraded source matching instead of an empty index-only query. Writes/relations/resync require a ready delegate. Normal source status is source/capability information, not the full direct-framework status shape. Direct ObjectFramework still waits by default; explicit maintenance sync/status remain separate. See [[features/resilient-source-access|Resilient source access]] and `docs/recovery.md`. No new decision rationale or test result is asserted.

## Typed References

- [[scenarios/resync-index-reconciliation|resync-index-reconciliation]]
- [[adrs/adr-filesystem-commit-and-reconciliation|adr-filesystem-commit-and-reconciliation]]

## Refresh Source Bindings

- implementation: `src/cli.ts`
- implementation: `src/lib/resilient-runtime.ts`
- implementation: `src/lib/source-access/index.ts`
- documentation: `docs/decisions/0015-defer-the-startup-reconciliation.md`
- documentation: `docs/recovery.md`
