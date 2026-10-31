---
id: markdown-serializes-frontmatter-and-body
name: markdown serializes frontmatter and body
title: Serialize frontmatter and body
description: A serialized object contains a --- delimited YAML frontmatter mapping followed by the exact Markdown body.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: markdown-frontmatter-round-trip
  dependsOn: []
---
## Statement
Serialize frontmatter and body: A serialized object contains a --- delimited YAML frontmatter mapping followed by the exact Markdown body.
## How it is observed
The written file starts with ---, contains a YAML mapping and reproduces the body byte for byte after the closing delimiter.