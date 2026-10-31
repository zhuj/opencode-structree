---
id: search-bounds-enforced
name: Search Bounds Are Enforced
title: Search Bounds Are Enforced
description: Search parameters stay inside the configured limits.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-21T00:12:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - search-hits-revalidated
  commitsTo:
    - adr-flat-search-namespace
    - adr-search-query-and-availability-guidance
---
## Rule
Framework search MUST reject a query that is not a string or is blank after trimming. It MUST reject unknown modes and unregistered type names.

topN MUST default to search.defaultTopN when omitted and MUST be a safe integer from 1 through search.maxTopN.

The default mode MUST be hybrid when the framework has a provider instance and fulltext otherwise. A configured provider label MUST NOT be treated as proof that the provider is usable.

Omitting types MUST search across registered types. After validating the request, types: [] MUST return no hits without invoking the embedding provider. A nonempty type subset MUST restrict both lexical and semantic candidates before their ranking limits.

For an otherwise valid request not short-circuited by types: [], semantic or hybrid evaluation without a provider MUST fail with EMBEDDINGS_DISABLED. For a noncancelled request, rejection of the query-embedding call MUST be surfaced as EMBEDDINGS_UNAVAILABLE.

Explicit fulltext evaluation MUST NOT invoke the embedding provider. Semantic or hybrid failures MUST NOT silently fall back to fulltext; tool guidance MUST identify an explicit fulltext request as the embedding-free recovery.

## Evidence
`src/lib/framework.ts` `ObjectFramework.search`; `src/lib/mcp.ts` `buildInputSchemas`; `test/framework.test.ts`

## Why it matters
A caller that reads a bound, a default or a provider rule must not be rejected by the runtime for it, and a failed semantic search must not quietly become a different kind of search.