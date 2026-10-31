---
id: markdown-checksum-stable
name: markdown checksum stable
title: Keep the checksum stable
description: Parsing identical bytes twice yields the same checksum, while a BOM or a CRLF change alters it.
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
Keep the checksum stable: Parsing identical bytes twice yields the same checksum, while a BOM or a CRLF change alters it.
## How it is observed
Two parses of the same bytes return an equal checksum, and a changed BOM or line ending returns a different one.