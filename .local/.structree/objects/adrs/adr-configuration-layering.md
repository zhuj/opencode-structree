---
id: adr-configuration-layering
name: Configuration layering
title: Configuration Layering
description: Configuration is layered so that the optional local YAML file at .local/.structree/config.yaml is applied last and overrides both the built-in defaults and any --config JSON file.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  commitment:
    scenarios:
      - load-json-configuration
      - local-yaml-override-layer
  partOf: null
  dependsOn: []
---
## Context
This decision is recorded in the project's session memory in `.local/.memory/decisions/20261020-144500-configuration-layering.md`, and it rests on a project-owner choice rather than a document review. The project owned its data in `objects/` at the repository root, which was deliberately not git-ignored, so every object file appeared as untracked work, while the derived index and the model cache lived in a separate `.object-mcp/` directory with a different name and lifecycle. The owner asked on 2026-10-20 for a single local state area, a configurable embedding model and no migration of existing data, plus a per-working-copy override for values such as the model and its dimensions.

## Decision
The CLI resolves configuration in the order built-in defaults, then the `--config` JSON file, then `.local/.structree/config.yaml` when it exists, so the local YAML file wins and is never selected by a flag. Relative values from a JSON file resolve against that file's own directory, relative values from the YAML file resolve against the project root, and naming a provider in the YAML file takes ownership of the whole `embeddings` section, dropping provider-specific values when that provider is `disabled`. The project owner accepted this on 2026-10-20, choosing both open options explicitly.

## Consequences
- Object data and derived state live under one git-ignored directory, so the working tree stays clean and a per-copy model selection becomes possible.
- The new paths became the library's built-in defaults rather than only this repository's configuration files, which avoids two sources of truth; programmatic `defineConfig` callers are unaffected apart from those defaults.
- Changing the configuration never moves existing objects, and a server process started before the change keeps its old paths until it is restarted.
- A YAML `embeddings` section that names only a model against a disabled provider is ignored rather than failing schema validation, and the legacy `objects/` and `.object-mcp/` directories remain on disk as leftovers.

## Evidence
- `.local/.memory/decisions/20261020-144500-configuration-layering.md`
- `.local/.progress/2026-10-20-1446-layout-config-yaml.md`
- `src/lib/config.ts` (`loadConfig`, `mergeLayers`, `mergeEmbeddings`, `resolveLayerPaths`) and `test/config.test.ts`