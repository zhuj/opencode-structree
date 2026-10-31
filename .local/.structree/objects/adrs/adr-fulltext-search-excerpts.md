---
id: adr-fulltext-search-excerpts
name: Fulltext Search Excerpts
title: Fulltext Search Excerpts
description: A search hit carries bounded native evidence of why it matched, as a separate optional field that does not pretend to have coordinates.
createdAt: 2026-10-21T00:40:00.000Z
updatedAt: 2026-10-21T00:40:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  commitment:
    scenarios:
      - full-text-bm25-ranking
  partOf: null
  dependsOn:
    - adr-search-query-and-availability-guidance
---
# Fulltext search excerpts

## Context

A search test against the live vault on 2026-10-20 showed that a full-text hit carried no evidence of why it
matched, so a caller had to issue a separate read for every hit. The index already held the text that matched.
A runtime probe then established, identically under better-sqlite3 and bun:sqlite, that the search engine's own
native extraction works against this repository's trigger-maintained full-text table, that it selects the raw
document column, that a match which exists only in the YAML frontmatter returns the raw fragment holding the
matched value, and that its token budget can return a short document whole.

The same probe showed why the disclosure has to be stated rather than assumed: an excerpt can carry frontmatter and
body content, and a complete short document, while the body itself stays opt-in.

## Decision

A search hit carries an optional fulltextExcerpt. The concrete index always emits it: a string when the hit has a
lexical match and null otherwise. It is produced by the engine's own extraction of the matching indexed column in
the same statement that evaluates the match and the score, bounded by a fixed token budget and then by the
configured code-point limit. It carries no coordinates, no chunk index and no column attribution, and the
semantic chunk contract is untouched. The tool description states the disclosure, and the size limit is
described as a size bound rather than as redaction.

## Rejected alternatives

- Reusing the coordinate-bearing chunk shape for the excerpt: a snippet taken from the name or the title has no
  raw-file coordinates, and a native excerpt can contain inserted omission markers, so the coordinates would be
  fabricated.
- Computing the excerpt in the application from the indexed text: a substring search is wrong for an AND query,
  for punctuation, for folded diacritics and for any future stemming, and it would duplicate the engine's
  behavior.
- Leaving the excerpt empty and telling callers to read every hit: that is the round trip this decision removes.

## Consequences

- A caller reads why a hit matched without an extra request per hit.
- Responses grow, and a bounded excerpt can disclose content the body opt-in keeps out of the body field.
- A producer that omits the field stays valid, so the public shape remains backward compatible.
- The ranking, the ordering, the filters, the limits and the semantic chunk are unchanged.

## Evidence

- `docs/decisions/0009-fulltext-search-excerpts.md`
- `docs/search-quality-plan.md`
- `src/lib/sqlite/fts-index.ts`, `src/lib/sqlite/index.ts`, `src/lib/types.ts`, `src/lib/mcp.ts`
- `test/search-abstraction.test.ts`, `test/sqlite.test.ts`, `test/framework.test.ts`, `test/mcp.test.ts`