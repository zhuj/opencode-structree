---
id: fulltext-query-semantics
name: Fulltext Query Semantics
title: Fulltext Query Semantics
description: "The lexical query rules an agent must know: literal tokens joined by AND, folded case and diacritics, no stemming, and no operator syntax."
createdAt: 2026-10-21T00:10:00.000Z
updatedAt: 2026-10-21T00:10:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - adr-search-query-and-availability-guidance
---
## Rule
These rules govern lexical evaluation by the concrete framework in fulltext mode and the lexical component of hybrid mode.

Lexical search MUST index the object's name, title and complete raw YAML Markdown document, including frontmatter and body. It MUST NOT inject the registered type name or directory name as additional searchable text.

The query encoder MUST extract runs matching `[\p{L}\p{N}\p{M}]+`, deduplicate identical extracted strings, quote each retained token and combine them with AND. Deduplication and the distinct-token count MUST occur before SQLite case or diacritic folding.

Lexical matching MUST use `unicode61 remove_diacritics 2`, with its case and diacritic folding and without stemming. Literal-token matching MUST NOT be described as byte-exact substring matching.

Quotes and punctuation MUST NOT enable phrase matching, asterisks MUST NOT enable prefix matching, and AND, OR and NOT MUST be treated as ordinary required tokens rather than operators.

When lexical evaluation runs, more than 128 distinct extracted tokens MUST fail rather than truncate the query. The current framework exposes this encoder failure as INTERNAL, not VALIDATION.

A nonblank query that produces no extracted tokens MUST produce no lexical candidates. This rule MUST NOT be interpreted as suppressing semantic evaluation or its provider errors in hybrid mode.

## Evidence
`src/lib/sqlite/fts-index.ts` `literalFtsQuery`; `src/lib/sqlite/cache-database.ts` `ObjectMetadataTable` columns, weights and tokenizer; `src/lib/framework.ts` `ObjectFramework.search`; `test/sqlite.test.ts`

## Why it matters
A query built from a type name, a phrase or a wildcard finds nothing, and an empty result then reads as absence.