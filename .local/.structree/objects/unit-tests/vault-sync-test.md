---
id: vault-sync-test
name: vault-sync.test.ts
title: Vault Sync Test
description: Verifies watcher readiness, debounce, periodic rescans, shared passes and partial snapshot handling.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-21T08:32:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - sc-resync-counts
    - sc-partial-scan-safety
    - sc-agent-tool-surface-sweep
  commitsTo:
    - sync-issue
    - sqlite-metadata-row
    - markdown-source-file
---
## File
test/vault-sync.test.ts
## What it covers
watcher readiness precedes the initial scan and changes during that scan cause another pass | parallel resync requests share all dirty passes while cancellation belongs to one waiter | continuous changes yield after the pass limit and continue in a later batch | an event between completion notification and promise cleanup is not lost | failed watcher startup closes installed resources without beginning a scan | shutdown while readiness is pending releases startup without a reconciliation | a failed reconciliation does not poison later explicit requests | observer failures are reported without breaking reconciliation or event delivery | shutdown drains failing work and ignores requests and watcher callbacks after stopping | periodic fallback works without filesystem notifications and stops at shutdown | periodic recovery progresses when the debounce is longer than the rescan interval | periodic recovery never overlaps passes and still follows a change made during a pass | a watcher close failure is returned only after active reconciliation has drained | an already cancelled waiter never starts new reconciliation work | partial scans update valid entries while preserving unknown cached identities | an incomplete snapshot invalidates a confirmed conflict without removing unseen rows | duplicate snapshot identities fail before any cache mutation or removal | a failed upsert cannot be followed by a destructive missing-item pass | publishes relative Markdown and directory events while excluding hidden and unrelated files | closing an actual watcher before readiness releases the pending start promise
## Verifies
resync-index-reconciliation, partial-scan-preserves-cache, filesystem-reconciliation
## Exercises
sync-issue, sqlite-metadata-row, markdown-source-file