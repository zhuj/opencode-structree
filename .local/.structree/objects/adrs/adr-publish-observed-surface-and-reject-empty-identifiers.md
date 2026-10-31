---
id: adr-publish-observed-surface-and-reject-empty-identifiers
name: Publish Observed Surface And Reject Empty Identifiers
title: Publish Observed Surface And Reject Empty Identifiers
description: The published tool surface names the error class of a lexical overflow, states the hybrid fallback and the retired-object rule, and an empty identifier is refused instead of stored.
createdAt: 2026-10-21T07:05:00.000Z
updatedAt: 2026-10-21T07:05:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  commitment:
    scenarios:
      - mcp-tool-error-contract
      - mcp-crud-tool-round-trip
      - full-text-bm25-ranking
  partOf: null
  dependsOn:
    - adr-search-query-and-availability-guidance
---
## Context

Driving the live tool surface on 2026-10-21 found four places where the published text was silent about
what the server actually does. A query above the 128-token lexical cap failed with a code the tool
description did not name, so a caller's own over-long query looked like a server fault. A query with no
lexical tokens returned semantic-ranked hits in hybrid mode while the description only said it yielded
no lexical matches. A retired object stayed in the listing and in search results, and nothing said so.
A create with an empty owner identifier was accepted and stored, so a required owner could point at
nothing.

## Decision

Publish the observed behavior instead of leaving it to be inferred, and refuse an empty identifier.

The published query description names the `INTERNAL` class of the lexical overflow. The published mode
description states that hybrid still runs the semantic ranking for a query with no lexical tokens and
that those hits carry no lexical evidence. The retiredAt field description and the per-type list
description state that a retired object is still listed and still searchable, and that the field is
how a caller excludes it. Every identifier, in the object and in a relation, is refused when it is
empty, and the published JSON Schema exposes `minLength: 1` for those fields.

The 128-token cap is kept and its rationale is recorded. It is a self-imposed bound on the generated
FTS5 MATCH expression, not a SQLite limit: on 2026-10-21 SQLite 3.53.4 executed 2000 AND-joined and
5000 OR-joined terms without error.

## Consequences

The published surface grows, and the tool list costs a little more context. The error class of an
over-limit query is still `INTERNAL`, which stays a deliberate choice recorded in decision 0008. The
listing and search behavior did not change, only the published text about it. An empty identifier is
now an invalid input instead of a stored value, which is a write that used to succeed.