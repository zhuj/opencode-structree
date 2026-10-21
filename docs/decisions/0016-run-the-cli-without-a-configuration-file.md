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

# 0016. Run the CLI without a configuration file

## Decision summary

Treat `--config` as optional. Without it the CLI uses the built-in defaults as the
base configuration layer and applies the optional local override file
`.local/.structree/config.yaml` last. The CLI no longer falls back to an implicit
`object-mcp.config.json` in the working directory.

## Context and problem statement

The CLI resolved an absent configuration argument to `object-mcp.config.json`
in the working directory. A project without that file could not start the
server at all: the run failed with a `CONFIG` error before a single tool was
served, and the failure named a file the operator never asked for.

The framework already defines complete built-in defaults for every setting: the
source root `.local/.structree/objects`, the derived index
`.local/.structree/.cache/index.sqlite`, and the local ONNX provider. The local
override file already exists as the documented project-local layer. Together they
are a complete configuration, so requiring a tracked JSON file to run the server
was an extra step without a corresponding guarantee.

## Decision drivers

- Let a project run the server, the diagnostic commands, and the full-text
  configuration with no configuration file at all.
- Keep the local override file as the last layer in every mode, so a project
  that configures nothing still has one documented place to configure.
- Do not read a file by convention. A configuration file is either named
  explicitly or written to the documented local override path.
- Keep the explicit `--config` path and its resolution rules unchanged.

## Considered options

1. **Keep the implicit `object-mcp.config.json` fallback.** Rejected. It fails
   in every directory that does not contain that file, and it silently applies a
   configuration the operator did not name.
2. **Read a conventionally named file only when it exists.** Rejected. It keeps
   two ways to configure the same project, and the effective configuration then
   depends on a file that may or may not be present.
3. **Use the built-in defaults plus the local override layer when no
   `--config` is given.** Selected. The defaults are already complete, the
   override layer is already the last layer, and the effective configuration
   becomes explicit in every case.

## Decision outcome

`src/cli.ts` loads the configuration through `loadDefaultConfig()` when the
argument list carries no `--config` file, and through `loadConfig(file)`
otherwise. `loadDefaultConfig()` merges the built-in defaults with the local
YAML layer using the same section and provider rules that the JSON path uses,
and resolves relative paths against the project root, which is the directory
the command runs in.

The explicit path keeps its own rules: relative values inside a JSON
configuration file resolve against that file's own directory, and the local
override file still wins over both layers.

## Consequences

### Positive

- A fresh directory can run `serve`, `sync`, and `status` without a
  configuration file.
- The effective configuration of a project is the built-in defaults plus one
  documented optional file, with no hidden file discovery.
- The diagnostic commands and the server report the same layout they use, so
  the status report describes the default project layout exactly.

### Negative

- The default provider is the local ONNX model, so `serve` and `sync` prepare
  that snapshot at startup and fetch it when the shared user cache is cold. A
  project that wants no model traffic selects a `disabled` provider in the
  local override file or passes a configuration file that disables it.
- A project that previously relied on the implicit `object-mcp.config.json`
  fallback now uses the built-in defaults unless it names the file. The
  shipped file in this repository restates the defaults, so the two agree.

## Confirmation

`test/config.test.ts` asserts that the default configuration loads without a
configuration file, that it uses the default root, index path, provider and
search bounds, and that the local override layer still applies to it.
`test/cli.test.ts` runs the `status` command as a subprocess in a directory
that holds no configuration file and asserts the default root and provider, and
runs it again with a local override file that disables the provider. The
usage text test asserts that the optional form is published.

The suite, the type check, and the lint check pass. A manual run of `status` and
`serve` without `--config` in an empty directory created the default layout,
advertised the 64 tools, and answered `objects_status`; the shared model cache
already held the pinned snapshot, so preparation made no network request.

## Links

- [Quick start and client configuration](../../README.md#quick-start).
- [Configuration reference](../configuration.md).
- [Local override file](../configuration.md#local-override-file).
- [Configuration loading](../../src/lib/config.ts).
- [CLI command policy](../../src/cli.ts).
