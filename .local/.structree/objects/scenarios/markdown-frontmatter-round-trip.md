---
id: markdown-frontmatter-round-trip
name: markdown round trip
title: Markdown Frontmatter Round Trip
description: Writes an object as YAML frontmatter plus an exact Markdown body and reproduces the same checksum when it is read back.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  project: structree-initial
  partOf: null
  dependsOn: []
  commitment:
    features:
      - vault-file-object-model
      - object-registry-and-schemas
---
## Context
Writes an object as YAML frontmatter plus an exact Markdown body and reproduces the same checksum when it is read back.

## Expected behaviour
A created object is written as YAML frontmatter plus its exact body and re-read identically.

## Failure modes
Missing or excess header fields, oversized content and invalid UTF-8 are refused.

## Covered by
markdown-serializes-frontmatter-and-body, markdown-checksum-stable