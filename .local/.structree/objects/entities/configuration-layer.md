---
id: configuration-layer
name: Configuration Layer
title: Configuration Layer
description: One precedence layer of the framework configuration such as the built-in defaults, the JSON config file or the local YAML override.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  usedBy:
    - config-never-migrates-objects
    - config-rejects-invalid-settings
    - cache-outside-source-root
  usedIn:
    - config-loader-api
    - cli-serve
    - cli-sync
    - cli-status
    - object-facade
    - mcp-server-factory
    - embedding-provider-factory
  commitsTo:
    - adr-configuration-layering
    - adr-local-state-layout
---
## Fields
- root
- sqlite, embeddings, chunking, sync, search, server, mcp
## Lifecycle
Read at startup, merged from the lowest to the highest precedence, validated, and path-resolved; it is never written back and never mutates stored objects.
## Usage
Supplies the settings of the CLI commands, the framework, the MCP server and the embedding provider.