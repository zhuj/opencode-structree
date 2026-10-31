---
id: adr-prepare-the-model-snapshot-at-startup
name: Prepare The Model Snapshot At Startup
title: Prepare The Model Snapshot At Startup
description: The local ONNX provider fetches its pinned snapshot at startup instead of requiring a manual preparation step, and the offline switch stays.
createdAt: 2026-10-21T04:40:00.000Z
updatedAt: 2026-10-28T10:22:56.263Z
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
      path: docs/decisions/0010-prepare-the-model-snapshot-at-startup.md
      role: documentation
    - root: project
      path: docs/recovery.md
      role: documentation
relations:
  commitment:
    scenarios:
      - embedding-provider-failures
  partOf: null
  dependsOn: []
---
# Prepare the model snapshot at startup

## Context

The embedding provider was deliberately offline-first: normal operation read a prepared snapshot, a missing
snapshot reported MODEL_NOT_CACHED, and the documentation stated that the provider makes no model-download
requests. The consequence was that a fresh installation could not use semantic search until a person ran the
preparation script by hand, and the repository's own vault had no vectors at all, so every object recorded an
embedding issue. The request was for the code to fetch the model automatically on start.

## Decision

The built-in default for embeddings.localFilesOnly becomes false, so a missing snapshot may be fetched. The
provider can ensure its pinned snapshot exists without loading the model, and it returns the snapshot directory
without any network request when every required file is already present. The shipped CLI prepares the provider
for the serve and sync commands; the read-only status command does not. The library framework exposes the
preparation to its host and fetches nothing on its own. A preparation failure is recorded as the last error and
does not stop the server: the full-text path keeps working and the semantic path keeps its existing error.

## Rejected alternatives

- Preparing inside the library's framework creation: every host would pay for a large download, and even a
  read-only status report would fetch 113 MB of model weights it never uses.
- Fetching during the first query: the delay would land on a user request rather than on startup, where it is
  visible and belongs.
- Removing the offline switch: an air-gapped deployment still needs a way to refuse the fetch, and the refusal
  is a configuration value rather than a build.

## Consequences

- A fresh installation reaches semantic search without a manual step.
- The first start needs network access and fetches roughly 135 MB; later starts read the cached snapshot.
- The model itself stays unloaded until a query needs it, so the preparation costs a download and not memory.
- A deployment that must not reach the network sets embeddings.localFilesOnly to true and keeps the previous
  behavior, including the MODEL_NOT_CACHED report and the manual preparation command it names.

## Evidence

- `docs/decisions/0010-prepare-the-model-snapshot-at-startup.md`
- `src/lib/embeddings/model-cache.ts`, `src/lib/embeddings/onnx.ts`, `src/lib/framework.ts`, `src/cli.ts`
- `test/embeddings.test.ts`, `test/config.test.ts`, `test/framework.test.ts`

## Current Implementation Qualification (2026-10-28)

The historical rationale/decision above is preserved rather than retroactively invented or rewritten. Later resilient source-first serving changed normal serve: it does not prepare embeddings and its optional framework uses projection reconciliation. Explicit sync still prepares; status does not; library hosts retain explicit choice. Thus serve-related historical consequences above are not current startup guarantees. See [[features/resilient-source-access|Resilient source access]], `src/cli.ts`, `src/lib/resilient-runtime.ts` and `docs/recovery.md`. No model operation or test was run during this refresh.

## Typed References

- [[scenarios/embedding-provider-failures|embedding-provider-failures]]

## Refresh Source Bindings

- implementation: `src/cli.ts`
- implementation: `src/lib/resilient-runtime.ts`
- documentation: `docs/decisions/0010-prepare-the-model-snapshot-at-startup.md`
- documentation: `docs/recovery.md`
