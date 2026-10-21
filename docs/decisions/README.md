# Architecture decision log

These records document the implemented choices and their trade-offs. Each record carries its own decision status. ADRs 0004, 0005, and 0006 capture the user's explicit requests to adopt the supplied database/table abstraction, relaxed MCP parsing, and reusable vault/library boundary; ADR 0007 records the truthfulness and bounding changes to the tool surface that the language-model ergonomics review produced; the earlier records retain their proposed status.

| Record | Status | Decision |
| --- | --- | --- |
| [0001](0001-filesystem-commit-and-reconciliation.md) | proposed | Commit source files first; reconcile derived search state with explicit readiness. |
| [0002](0002-sqlite-search.md) | proposed | Use ordinary SQLite vector rows with exact filtered sqlite-vec distance evaluation and document ranking. |
| [0003](0003-embedding-windows.md) | proposed | Preserve complete source coverage through overlapping retrieval chunks and complete-input embedding aggregation. |
| [0004](0004-adopt-database-table-abstractions.md) | accepted | Adopt the supplied database/table structure with Effect codecs, composite keys, and guarded synchronous commits. |
| [0005](0005-repair-mcp-inputs-before-effect-validation.md) | accepted | Repair uniquely identifiable MCP argument structure, then validate it with the original strict Effect codec. |
| [0006](0006-extract-library-and-adopt-vault.md) | accepted | Extract reusable implementation into src/lib and compose a generic Markdown vault below object identity and search policy. |
| [0007](0007-advertise-effective-bounds-and-bound-status-output.md) | accepted | Advertise the effective bounds, bound the status report with visible counters, and publish the type names, the object model and the workflow in the existing tool surface. |
| [0008](0008-search-query-and-availability-guidance.md) | accepted | Publish truthful lexical query, type-filter, provider-availability and bounded-discovery guidance without changing retrieval or status shapes. |
| [0009](0009-fulltext-search-excerpts.md) | accepted | Return bounded native lexical evidence in optional fulltextExcerpt, permitting source-content disclosure independently of includeBody while preserving semantic chunk coordinates. |

The records identify actual test evidence and practical limits. Future changes should supersede a decision with a new numbered record rather than rewrite accepted history.
