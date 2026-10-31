---
id: adr-search-query-and-availability-guidance
name: Search Query And Availability Guidance
title: Search Query And Availability Guidance
description: The search surface states the real query semantics, the provider requirement and the limits of discovery, instead of leaving an agent to infer them.
createdAt: 2026-10-21T00:10:00.000Z
updatedAt: 2026-10-21T00:10:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  commitment:
    scenarios:
      - full-text-bm25-ranking
      - embedding-provider-failures
  partOf: null
  dependsOn: []
---
# Search query and availability guidance

## Context

A search test against the live 282-object vault on 2026-10-20 showed that the search works and ranks
deterministically, but that nothing in the tool surface told an agent how to query it. A query is an AND
of literal Unicode tokens with no stemming, punctuation and quotes are separators rather than operators,
an asterisk is stripped rather than treated as a prefix, the registered type name is not part of the
indexed text, a configured provider is not a usable provider, and search is neither exhaustive nor
guaranteed to include recent objects. An agent that did not know this either guessed or received an empty
result and concluded the object did not exist.

## Decision

The advertised query, type and mode descriptions and the search and status tool descriptions state the
real semantics, the provider requirement, the full-text recovery and the limits of discovery. Retrieval,
ranking, the tool count, the input and output shapes, the status shape, the error codes and the validation
behavior do not change. The tokenizer stays as it is, no readiness field is added, and the excerpt field
and the tokenizer option are separate deliveries with their own decisions.

## Rejected alternatives

- Documenting the semantics outside the tool surface, so an agent that only reads the tool list still
  cannot learn them.
- Adding a readiness flag to the status response: a configured provider, a present snapshot and zero
  pending embeddings are three different things, and only a successful inference is readiness.
- Enabling the Porter tokenizer: the measured result widens recall for some inflection pairs but leaves
  the motivating pair unmatched, and it would change ranking for every existing index and force a rebuild
  that re-embeds every document when a provider is enabled.

## Consequences

- A caller can form a valid query from the tool list alone, and knows that an empty result is not proof
  that an object is absent.
- The status response keeps its shape; what changes is that it no longer invites a readiness reading.
- The discovery guarantees are now recorded as contracts rather than as prose.

## Evidence

- `docs/decisions/0008-search-query-and-availability-guidance.md`
- `docs/search-quality-plan.md`
- `src/lib/mcp.ts`, `src/lib/sqlite/fts-index.ts`, `src/lib/framework.ts`
- `test/mcp.test.ts`, `test/sqlite.test.ts`, `test/framework.test.ts`