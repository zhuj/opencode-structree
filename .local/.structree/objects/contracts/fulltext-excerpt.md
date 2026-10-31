---
id: fulltext-excerpt
name: The Search Hit Carries A Bounded Lexical Excerpt
title: The Search Hit Carries A Bounded Lexical Excerpt
description: A hit with a lexical match carries bounded evidence of the match, as a separate optional field with no coordinates.
createdAt: 2026-10-21T00:40:00.000Z
updatedAt: 2026-10-21T00:40:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - fulltext-query-semantics
  commitsTo:
    - adr-fulltext-search-excerpts
---
## Rule
The concrete index MUST emit the excerpt field on every search hit: a string when the hit has a lexical match, including a hybrid hit whose lexical contribution is present, and null when it has none, including a semantic-only candidate inside a hybrid result.

The excerpt MUST be produced by the search engine's own extraction of the matching indexed column, in the same statement that evaluates the match and the score. It MUST NOT be reconstructed by application-side token matching.

The excerpt MUST be bounded: the native extraction uses a fixed token budget, and the published excerpt is truncated to the first search.maxMatchCharacters Unicode code points without splitting a surrogate pair.

The excerpt MUST NOT carry coordinates, a chunk index or column attribution, and the semantic chunk contract MUST remain unchanged.

The excerpt MUST be discarded together with its hit when the source-checksum revalidation rejects that hit, and it MUST NOT require an additional per-hit read.

The public shape MUST make the field optional, so a producer that omits it remains valid; its absence means no excerpt was supplied and not that no lexical match exists.

The excerpt MAY contain YAML frontmatter or Markdown body content, and MAY contain a complete short document, even when the body was not requested. The size limit is a size bound and not redaction, and the surface states that disclosure.

## Evidence
`src/lib/sqlite/fts-index.ts` `searchRowsWithExcerpt`; `src/lib/sqlite/index.ts`; `src/lib/types.ts` `SearchHit`; `src/lib/mcp.ts` `SearchOutput`; `test/sqlite.test.ts`, `test/search-abstraction.test.ts`, `test/framework.test.ts`, `test/mcp.test.ts`, `scripts/smoke-stdio.py`

## Why it matters
A hit that cannot show why it matched forces a read per hit, and a caller that cannot see the evidence either reads everything or trusts the ranking blindly.