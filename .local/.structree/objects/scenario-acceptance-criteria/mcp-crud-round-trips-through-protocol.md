---
id: mcp-crud-round-trips-through-protocol
name: mcp crud round trips through protocol
title: Round-trip crud through the protocol
description: A create call writes a Markdown file and returns ISO date strings, and get, update, delete and list return matching records.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: mcp-crud-tool-round-trip
  dependsOn:
    - mcp-advertises-generated-tools
---
## Statement
Round-trip crud through the protocol: A create call writes a Markdown file and returns ISO date strings, and get, update, delete and list return matching records.
## How it is observed
The Markdown file exists in the object directory and every returned date is an ISO string.