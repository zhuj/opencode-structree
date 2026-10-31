---
id: mcp-server-factory
name: MCP Server Factory
title: MCP Server Factory
description: Creates an MCP server with the shared and per-type tools registered against a facade.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - mcp-object-crud-tools
  usedBy:
    - repair-preserves-strictness
  commitsTo:
    - adr-project-local-mcp-registration
    - adr-repair-mcp-inputs-before-validation
---
## Surface
src/lib/mcp.ts - createMcpServer and registerObjectTools.
## Behavior
Creates an MCP server with the shared and per-type tools registered against a facade.
## Guarantees
- The caller keeps ownership of the facade and its transport lifetime.
- The repair options of the facade are inherited unless explicitly overridden.
- The generated tool names are reserved by the host.