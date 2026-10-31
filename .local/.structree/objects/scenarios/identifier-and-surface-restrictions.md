---
id: identifier-and-surface-restrictions
name: identifier and surface restrictions
title: Identifier And Surface Restrictions
description: The server refuses an empty identifier and publishes the behavior of the search and listing surfaces.
createdAt: 2026-10-21T07:05:00.000Z
updatedAt: 2026-10-21T07:05:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  project: structree-initial
  partOf: null
  dependsOn: []
  commitment:
    features:
      - mcp-tool-surface
      - object-registry-and-schemas
      - full-text-search
---
## Scenario

When a caller creates, reads, updates or deletes an object, an empty identifier is refused as invalid
input, and the published tool surface states the observed behavior of the lexical token cap, the
hybrid fallback and the retired-object rule.

A create with an empty owner identifier is a caller mistake that the server can name, so it is
refused rather than stored. A query that exceeds the lexical token cap is a caller mistake too, and
the published description names the code so the caller can shorten its own query instead of
reporting a server fault.