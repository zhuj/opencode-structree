---
id: adr-project-local-mcp-registration
name: Project-local MCP registration
title: Project-Local MCP Registration
description: The repository registers its own structree MCP server in project-local OpenCode V2 configuration, running the built bundle against the model-free full-text configuration without touching global configuration.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-21T08:32:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  commitment:
    scenarios:
      - mcp-crud-tool-round-trip
      - cli-sync-and-status-commands
      - agent-tool-surface-sweep
  partOf: null
  dependsOn: []
---
## Context
This decision is recorded in the project's session memory and progress record: `.local/.memory/operations/opencode-mcp-activation.md` and `.local/.progress/2026-10-20-1350-opencode-mcp-setup.md`. The repository had no build script, no `dist/` and no `.opencode/` configuration, so the object registry was not reachable from an OpenCode session, and the user asked to "build and create .opencode with mcp so that i can use the project in the opencode session" on 2026-10-20. Model downloads were not permitted, so the registration had to work without preparing an embedding model.

## Decision
The project registers the server locally in `.opencode/opencode.json` under OpenCode V2's `mcp.servers.structree` shape, running `bun dist/cli.js serve --config examples/fulltext.config.json` with `cwd` resolved against the workspace, and the CLI is bundled by `bun run build` with packages kept external so native packages stay external. The full-text configuration is used because it disables embeddings and therefore needs no model download, and the setup was built and verified on 2026-10-20 by the project maintainers.

## Consequences
- The registry becomes reachable from an OpenCode V2 session with all 64 tools exposed, and a create, read, update, search and delete round trip was verified live on 2026-10-20 without any global configuration change.
- The build is a bundle rather than a standalone executable, so Bun and installed `node_modules` remain required and `dist/cli.js` must be rebuilt and the server reconnected after source changes.
- The full-text configuration leaves semantic and hybrid search unavailable, and a missing model snapshot surfaces as `MODEL_NOT_CACHED` while full-text search keeps working.
- MCP write tools create and modify authoritative Markdown under `.local/.structree/objects/`, so a rehearsal write leaves real source files behind unless it is deleted with the returned checksum.

## Evidence
- `.local/.memory/operations/opencode-mcp-activation.md`
- `.local/.progress/2026-10-20-1350-opencode-mcp-setup.md`
- `.opencode/opencode.json`, `package.json`, `scripts/smoke-stdio.py` and commit `0d1a5d9`