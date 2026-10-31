---
id: agent-skill-structree
name: Structree Skill
title: Structree Skill
description: "The project skill that teaches an agent how to use the structree MCP surface: when the vault is the right source, how to search before listing, how the checksum and caller-owned timestamps constrain a write, and what every relation field means."
createdAt: 2026-10-20T19:20:00.000Z
updatedAt: 2026-10-31T13:24:48.172Z
retiredAt: null
tags:
  audience: agents
  surface: mcp
metadata:
  path: .opencode/skills/structree
  entrypoint: SKILL.md
  references:
    - references/object-model.md
    - references/tool-reference.md
relations:
  partOf: null
  dependsOn:
    - mcp-objects-search
    - mcp-objects-definitions
    - mcp-object-crud-tools
  usedBy:
    - references-are-deliberately-dual-authored
  commitsTo:
    - adr-search-query-and-availability-guidance
    - adr-fulltext-search-excerpts
---
## Current Surface

.opencode/skills/structree/SKILL.md, references/object-model.md and references/tool-reference.md describe the twelve object families, canonical schema discovery, source-backed reads, fulltext discovery, checksummed writes, relation traversal, and optional local materialized graph workflows. The server definitions remain authoritative when skill and live schema disagree.

## Authoring Contract

[[contracts/references-are-deliberately-dual-authored|Deliberate Dual Reference Authoring]] requires intentional typed frontmatter relations and prose wikilinks. Automatic body-link extraction/addition and pruning for missing body links are prohibited by the confirmed owner decision. This describes authoring guidance, not an implemented automatic synchronizer.

## Read And Evidence Discipline

Search is bounded and not proof of absence; use exact get and complete paginated listings when absence matters. Read revisions before update/delete and preserve immutable identity/creation fields. Structural links and materialization coverage do not prove runtime behavior. The skill documents strict gate and development watcher boundaries, distinct from live MCP reads.

## Typed Dependencies And Rationale

- [[interfaces/mcp-objects-search|Search Surface]]
- [[interfaces/mcp-objects-definitions|Definitions Surface]]
- [[interfaces/mcp-object-crud-tools|Checksummed CRUD Surface]]
- [[adrs/adr-search-query-and-availability-guidance|Query And Availability Guidance]]
- [[adrs/adr-fulltext-search-excerpts|Bounded Fulltext Evidence]]

## Provenance And Limits

Inspected the loaded project skill and .local/.progress/2026-10-25-1825-body-reference-sync.md:84,109-124. The old claim that the skill contains no repository-specific paths/internal-layout guidance is no longer accurate: the current skill explicitly documents optional local graph commands and paths. Historical independent-review statements applied to earlier revisions, not proof of complete review of this current revision. No skill evaluation, application tests or host runs were performed in this extraction.
