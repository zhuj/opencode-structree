---
id: fts-query-tokens-are-literal-and-required
name: Fts Query Tokens Are Literal And Required
title: Fts Query Tokens Are Literal And Required
description: The lexical query is an AND of literal tokens, and the operator-like words and punctuation carry no special meaning.
createdAt: 2026-10-21T00:20:00.000Z
updatedAt: 2026-10-21T00:20:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: full-text-bm25-ranking
  dependsOn:
    - fts-ranks-by-bm25
---
## Statement
Fts query tokens are literal and required: A query is split into Unicode letter, number and mark tokens, every token is required, and AND, OR and NOT are ordinary words rather than operators. Quotes do not make a phrase and an asterisk does not enable a prefix, while a query of only punctuation yields no lexical candidate. More than 128 distinct tokens fails instead of truncating, and that failure is reported as INTERNAL.
## How it is observed
The advertised query description states these rules, the encoder assertions cover each of them, and an integration search under both SQLite drivers shows two words matching anywhere, OR and NOT treated as required content, a stripped asterisk not matching a longer word, a punctuation-only query returning no hits, and folded case and diacritics.