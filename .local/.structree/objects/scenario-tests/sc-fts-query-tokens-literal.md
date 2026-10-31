---
id: sc-fts-query-tokens-literal
name: Sc Fts Query Tokens Literal
title: Sc Fts Query Tokens Literal
description: The lexical query encoder and the advertised description state the same literal-token rules.
createdAt: 2026-10-21T00:20:00.000Z
updatedAt: 2026-10-21T00:20:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-full-text-query-semantics
  commitsTo:
    - search-api
---
## Test
literal query tokens are required and ANDed; operators and asterisks stay literal; punctuation yields no tokens; the token limit fails instead of truncating
## File
test/sqlite.test.ts, test/mcp.test.ts
## What it proves
Shows that the query encoder, the integration search under both SQLite drivers and the advertised description agree on the literal token rules.
## Criteria
fts-query-tokens-are-literal-and-required