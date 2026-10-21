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

# 0010. Prepare the model snapshot at startup

## Decision summary

Prepare the local ONNX provider for CLI `serve` and `sync`, fetching missing
pinned snapshot files when downloads are permitted. Change the built-in
`embeddings.localFilesOnly` default to false and preserve true as the offline
switch. Keep preparation explicit for library hosts, model loading lazy, and
preparation failures nonfatal to server startup and full-text search.

## Context and problem statement

The previous default was deliberately offline-first: `localFilesOnly: true`
required an already prepared model snapshot, made no model-download requests,
and reported `MODEL_NOT_CACHED` with a manual preparation command when files
were missing. That kept network access under operator control but left a fresh
installation unable to use semantic search until a person prepared the model.
The user's request was for the code to fetch the model on start instead.

The library is also embedded by other hosts, and the CLI has a read-only status
report. Neither is an unconditional invitation to download a large model.
Snapshot preparation and loading a tokenizer/model for inference are separate
operations. File presence must not be advertised as inference readiness.

## Decision drivers

- Make the normal CLI startup path prepare a missing pinned model automatically.
- Reuse a complete snapshot without a preparation network request.
- Preserve an explicit offline-only policy for air-gapped deployments.
- Leave download timing and failure policy under an embedding host's control.
- Preserve full-text availability, lazy loading and existing search errors.
- Align the advertised mode guidance, documentation, plan and runtime skill.

## Considered options

1. **Explicit CLI startup preparation with a library hook.** Selected. `serve`
   and `sync` call preparation; library hosts opt in and `status` does not.
2. **Prepare inside library framework creation.** Rejected because every host,
   including a read-only status report, would then pay for a large download
   merely by constructing the framework.
3. **Fetch during the first query instead of preparing at startup.** Rejected
   because download delay would land on a user request rather than on startup.
4. **Remove the offline switch.** Rejected because an air-gapped deployment
   still needs a way to refuse fetching altogether.

## Decision outcome

`EmbeddingProvider` has an optional `prepare(signal?)` method. The local ONNX
implementation delegates it to `ensureModelSnapshot`. When all required files
are already present, that helper returns the pinned snapshot directory without
a network request. This fast path checks presence, not fresh checksums or
inference. When a file is missing and downloads are permitted, it resolves the
pinned revision, verifies files against its metadata, and fetches missing or
invalid files. Downloaded content is checked against the pinned size and Git
blob or LFS SHA-256 digest before publication.

The built-in `embeddings.localFilesOnly` default is false. True retains the
previous offline-only behavior: a missing required file reports
`MODEL_NOT_CACHED` without fetching. The diagnostic now explains that the
snapshot is fetched at startup when `embeddings.localFilesOnly` is false and
otherwise names `bun scripts/prepare-model.ts --config <your-config.json>`.
The manual script remains an optional provisioning and synthetic inference
verification path, not the normal startup prerequisite.

`ObjectFramework.prepareEmbeddings(signal?)` calls the provider's optional hook;
without a provider or hook it does nothing. A failure is recorded as the
framework's last error, reported through `onError`, and rethrown. Framework
creation does not automatically perform preparation or fetch the snapshot;
the library host decides whether to call this method.

The CLI calls it for `serve` and `sync`, not `status`, because status is a
read-only report. The CLI catches a reported preparation failure and still
starts the server. Full-text search remains available; semantic/hybrid queries
retain their existing error contracts (`EMBEDDINGS_UNAVAILABLE` on provider
failure, `EMBEDDINGS_DISABLED` without a provider), with no silent downgrade.

Preparation fetches files but leaves the model unloaded. Tokenizer/model
loading remains lazy when inference first needs it. Snapshot presence does
not establish tokenizer, model or device readiness, and status does not probe
files or run inference. Search-mode defaults, type-filter behavior and the other four
advertised search/status descriptions remain unchanged. Only the provider
clause of the mode description changes:

> Defaults to hybrid when the framework has a provider instance, otherwise fulltext. Semantic/hybrid evaluation requires a working provider; the local ONNX provider fetches its pinned model snapshot at startup when the snapshot is missing and downloads are permitted. Use explicit mode: "fulltext" for embedding-free queries or after EMBEDDINGS_DISABLED/EMBEDDINGS_UNAVAILABLE. Valid requests with types: [] return no hits without invoking a provider.

## Consequences

### Positive

- Fresh CLI deployments can prepare semantic-search assets without a manual step.
- A complete snapshot needs no network request during preparation.
- Operators can retain offline-only behavior with `localFilesOnly: true`.
- Library hosts own preparation timing and how to handle its failures.
- Full-text search and the existing provider-error recovery path remain usable.

### Negative

- An unprepared default deployment can make network requests and incur a large
  download before the CLI starts serving. Explicit offline policy is now opt-in.
- Successful preparation is not proof of successful later inference; lazy model
  and device initialization can still fail.
- Failed preparation does not make semantic search work. Callers must still
  request `mode: "fulltext"` after an embedding availability error.
- A host embedding the library must explicitly choose whether to prepare;
  constructing a framework is not automatic preparation.

## Confirmation

The implementation is in `src/lib/embeddings/model-cache.ts`
(`ensureModelSnapshot` and the `MODEL_NOT_CACHED` diagnostic),
`src/lib/embeddings/onnx.ts` (`prepare` and lazy `load`), `src/lib/types.ts`
(`EmbeddingProvider.prepare?`), `src/lib/framework.ts` (`prepareEmbeddings`),
`src/cli.ts` (the `serve`/`sync` trigger and nonfatal catch),
`src/lib/config.ts` (the default), and `src/lib/mcp.ts` (the mode annotation).

The repository contains these focused regressions:

- `test/embeddings.test.ts`, `model snapshot preparation`:
  `a complete snapshot is used without any network request`,
  `a missing snapshot is refused when downloads are not permitted`, and
  `the provider fetches a missing snapshot when downloads are permitted`.
  They exercise temporary snapshot files and mocked downloads, not live models.
- `test/config.test.ts`:
  `the ONNX provider fetches a missing model snapshot by default and keeps the offline switch`.
- `test/framework.test.ts`, `embedding preparation at startup`:
  `preparing the embeddings calls the provider once and reports a failure without hiding it`.
  It checks delegation, last-error recording and rethrowing with a test provider.

This documentation update inspected those tests and the implementation without
executing tests, starting a server or making network requests. It does not
claim a new gate result, live model readiness or a measured startup latency.

## Links

- [Prior search guidance decision](0008-search-query-and-availability-guidance.md).
- [Search-quality plan](../search-quality-plan.md).
- [Configuration reference](../configuration.md#onnx-provider).
- [Embedding preparation and errors](../embeddings.md#local-onnx).
- [Reusable library guide](../library.md#the-facade-contract).
- [Snapshot preparation](../../src/lib/embeddings/model-cache.ts).
- [CLI wiring](../../src/cli.ts).
- [MCP schemas and descriptions](../../src/lib/mcp.ts).
