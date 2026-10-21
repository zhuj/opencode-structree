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

# 0014. Keep model snapshots in the user cache

## Decision summary

Keep pinned ONNX model snapshots in the global user cache, shared by every
project on the machine using that cache. The default `embeddings.cacheDir` is
`~/.cache/onnx/models`, or `$XDG_CACHE_HOME/onnx/models` when `XDG_CACHE_HOME` is
an absolute path. Authoritative Markdown sources and the derived search index
stay in the project. Explicit cache overrides and the requirement that the
model cache remain outside the object directory are unchanged.

## Context and problem statement

The previous default was a project-relative model-cache path inside the
project's own state directory. Every project using the same
pinned model downloaded its own copy of roughly 130 MB. The default is
`Xenova/multilingual-e5-small` at an immutable commit, with q8 weights and 384
dimensions; identical snapshots do not need a separate copy for each project.

The snapshot was also mixed into the state directory that holds the project's
authoritative Markdown sources and its derived search index. The weights are
neither project source nor a project-specific search artifact. They can be
reused independently of a project's objects and vectors.

## Decision drivers

- Avoid downloading and storing the same pinned weights once per project.
- Keep project-local state focused on sources, the search index and coordination.
- Give model snapshots a recognizable location within the user cache.
- Preserve explicit configuration, offline operation and vector-cache validity.
- Keep model files outside the authoritative object directory.

## Considered options

1. **Keep the project-local cache.** Rejected. It preserves the old layout but
   duplicates roughly 130 MB for each project using the same pinned model and
   mixes shared model assets into project-local state.
2. **Use the user cache without the `onnx` and `models` levels.** Rejected. It
   permits sharing, but places model identifiers directly in the user cache
   without a recognizable namespace for ONNX model snapshots.
3. **Use the user cache at `~/.cache/onnx/models`.** Selected. The `onnx/models`
   levels identify the asset type, and the shared location avoids per-project
   copies. An absolute `XDG_CACHE_HOME` replaces `~/.cache` as the user cache
   directory without changing those levels.

## Decision outcome

The default `embeddings.cacheDir` is the user cache directory joined with `onnx`
and `models`. Use `XDG_CACHE_HOME` only when it is set to an absolute path;
otherwise use `~/.cache`. A relative `XDG_CACHE_HOME` is ignored. The snapshot
layout remains `<cacheDir>/<model>/<revision>`.

An explicit `cacheDir` in a configuration file still overrides the default.
Relative values retain their existing resolution: against the project directory
for local overrides, the configuration file's directory for JSON `--config`
files, and `baseDirectory` for programmatic use. Configuration validation still
rejects a model cache inside the object directory.

The authoritative sources and derived search index stay in the project. The
README's project layout table therefore no longer lists model weights as part
of project-local state. This decision changes the default location, not snapshot
preparation, verification or loading behavior.

## Consequences

### Positive

- A pinned snapshot is downloaded once per machine for projects sharing the
  user cache, rather than once per project.
- The project's local directory no longer holds the weights by default; the
  layout table continues to describe what the project directory holds.
- `localFilesOnly` retains its meaning. When fetching is forbidden, a missing
  snapshot is still reported as `MODEL_NOT_CACHED` and nothing is downloaded.
- The embedding fingerprint is unchanged. It covers provider identity and
  preprocessing plus the retrieval chunking, never the cache location, so an
  existing vector cache stays valid when only the snapshot location changes.
- Preparation still verifies fetched files against pinned metadata without
  loading the model. Loading remains lazy, and the CLI still prepares for
  `serve` and `sync`, not the read-only `status` command. A preparation failure
  remains nonfatal to server startup.

### Negative

- Removing a shared snapshot affects every project that uses it. Offline
  projects need that snapshot restored before semantic inference can succeed.
- Existing project-local snapshots do not move merely because the default
  changes. Reuse requires a separate move or an explicit cache override;
  otherwise preparation fetches missing files when downloads are allowed.
- Copying only the project directory no longer carries the default weights.
  Offline provisioning must include the user-cache snapshot or an explicit
  compatible cache location outside the object directory.

## Confirmation

The parent session supplied the accepted location and compatibility contract
on 2026-10-21. Static inspection of `src/lib/config.ts` confirms the absolute
`XDG_CACHE_HOME` check, the `~/.cache` fallback, the `onnx/models` suffix, relative
path resolution and the enforced exclusion from the object directory.

This documentation lane checks the README, configuration and embedding guides,
decision log and structree skill for cache-location claims. Decisions 0001
through 0013 remain unchanged as historical records. The skill describes
preparation but does not specify a model-cache location, so it needs no change.

No snapshot move, download, inference, tests, configuration edits or vault
writes were performed by this lane. The parent session owns the existing
snapshot's relocation and provider verification; this record does not claim
that either has already completed.

## Links

- [Project storage layout](../../README.md#storage-layout-and-local-overrides).
- [ONNX configuration](../configuration.md#onnx-provider).
- [Snapshot preparation and loading](../embeddings.md#local-onnx).
- [Embedding cache identity](../embeddings.md#cache-identity).
- [Startup preparation decision](0010-prepare-the-model-snapshot-at-startup.md).
- [Configuration defaults and validation](../../src/lib/config.ts).
