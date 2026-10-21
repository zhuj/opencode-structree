---
status: accepted
date: "2026-10-21"
decision-makers:
  - User
consulted: []
informed: []
supersedes: []
superseded-by: []
---

# 0015. Defer the startup reconciliation

## Decision summary

Run the MCP server's first reconciliation in the background instead of waiting
for it before answering requests. Preserve the library's default of waiting for
the first pass, and keep diagnostic commands waiting so their reports describe
a completed pass. Report a deferred startup failure through the framework's
error channel without stopping the server.

## Context and problem statement

The server did not answer a request until its first reconciliation finished.
For a large vault, indexing all existing Markdown files makes that a long
startup. The filesystem is authoritative and SQLite is derived, rebuildable
state; access to the server does not require that every file already be indexed.

Reconciliation is also a repair path. It renames a discovered file whose base
name disagrees with the id inside it. Deferring the first pass therefore moves
both indexing and those filename corrections into the period when the server
is already answering requests, not merely a read-only scan.

## Decision drivers

- Let the MCP server answer without waiting for a large vault's first pass.
- Preserve the existing library creation contract unless a caller opts out.
- Keep diagnostic reports tied to a completed reconciliation.
- Publish truthful search and synchronization state during startup.
- Report startup failures without making a deferred failure fatal to serving.

## Considered options

1. **Keep waiting everywhere.** Rejected. It preserves the existing startup
   ordering but leaves the server unavailable until a potentially long pass ends.
2. **Defer for the MCP server only.** Selected. The server can answer while
   existing files are indexed, while library callers retain their default and
   diagnostic commands retain completed-pass reports.
3. **Defer everywhere, including the library.** Rejected. Returning from library
   creation before the first pass finishes would change the library contract
   for callers that have not asked for deferral.

## Decision outcome

Framework creation starts the watcher and first reconciliation. The CLI's
`serve` command sets `waitForStartup: false`, allowing the MCP server to answer
requests without waiting for that pass. The library still waits by default.
An explicit `waitForStartup()` returns the startup report or rejects with the
startup failure, including when creation did not wait.

The diagnostic `sync` and `status` commands keep waiting before printing their
reports. A deferred startup failure is reported through the framework's error
channel, does not stop the server, and remains visible to a caller that waits
for startup. While the pass runs, status reports that synchronization is in
progress and that no completed report exists yet.

The published search description includes this sentence verbatim:

> The server's startup reconciliation runs in the background, so a search issued right after it starts may find nothing; objects_status reports whether a synchronization is still running.

Create indexes its own object immediately. Create followed by search therefore
works while the background pass runs; what is missing from the index is the
existing content the pass has not reached. Reconciliation can also rename
existing files in this window to match their ids, without changing the
filesystem-authoritative storage contract.

## Consequences

### Positive

- The server answers requests while its initial index is being built.
- Library callers keep waiting unless they explicitly select deferral.
- `objects_status` exposes `syncing: true` and `lastSync: null` until a
  completed report exists, rather than presenting the pending pass as complete.
- Diagnostic reports still describe a completed pass.
- Deferred startup failures are reported rather than fatal, and waiting callers
  can still observe the original failure.
- Create followed by search does not have to wait for unrelated existing files.

### Negative

- An immediate search may find nothing, or miss files not yet indexed. An empty
  result is not proof of absence; agents need the synchronization state and
  source-backed get/list tools when checking existing content.
- Filename repairs can happen after the server starts answering. Startup
  reconciliation is not a read-only operation.
- A responsive server is not proof that the first pass succeeded. Hosts must
  observe the error channel or wait explicitly when they need that guarantee.

## Confirmation

The parent session supplied the accepted behavior on 2026-10-21. Static
inspection of `src/lib/framework.ts` confirms optional waiting, the retained
startup promise and deferred error reporting. `src/cli.ts` selects deferral only
for `serve`, and `src/lib/mcp.ts` publishes the startup search warning.

This documentation lane checks current search-description copies and records
the server, library, diagnostic and agent-facing contracts. Historical decisions
0001 through 0014 remain unchanged. No tests, runtime checks, configuration
changes or vault writes were performed by this lane; static inspection is not
runtime proof.

## Links

- [Server and diagnostic startup](../../README.md#quick-start).
- [Library facade contract](../library.md#the-facade-contract).
- [Filesystem commit and reconciliation](0001-filesystem-commit-and-reconciliation.md).
- [Filename repair decision](0013-name-the-file-after-the-id.md).
- [Framework startup and status](../../src/lib/framework.ts).
- [CLI command policy](../../src/cli.ts).
- [Published MCP tools](../../src/lib/mcp.ts).
