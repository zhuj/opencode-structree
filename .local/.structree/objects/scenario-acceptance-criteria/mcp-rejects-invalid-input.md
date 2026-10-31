---
id: mcp-rejects-invalid-input
name: mcp rejects invalid input
title: Reject invalid tool input
description: Omitted nullable fields, malformed dates and unknown fields fail validation before the facade mutates any file.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: mcp-tool-error-contract
  dependsOn: []
---
## Statement
Reject invalid tool input: Omitted nullable fields, malformed dates and unknown fields fail validation before the facade mutates any file.
## How it is observed
The call returns validation issues and no file is created or modified in the object directory.