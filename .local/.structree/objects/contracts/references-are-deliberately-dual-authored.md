---
id: references-are-deliberately-dual-authored
name: Deliberate Dual Reference Authoring
title: References Are Deliberately Dual-Authored
description: Authors intentionally maintain typed frontmatter relations and body wikilinks; automatic body-to-frontmatter extraction and pruning are not authorized.
createdAt: 2026-10-31T13:24:32.325Z
updatedAt: 2026-10-31T13:24:32.325Z
retiredAt: null
tags:
  basis: confirmed-owner-decision
metadata:
  fileBindings:
    - root: project
      path: .opencode/skills/structree/SKILL.md
      role: documentation
    - root: project
      path: .local/.progress/2026-10-25-1825-body-reference-sync.md
      role: documentation
relations:
  partOf: null
  dependsOn: []
  commitsTo: []
---
## Confirmed Authoring Policy

Authors keep references intentionally in the appropriate typed frontmatter relations and in Markdown prose using Obsidian wikilinks to actual vault-relative target paths. A body link does not determine a relation kind. Do not automatically infer or add frontmatter relations by scanning body wikilinks. Never automatically remove a frontmatter relation merely because a body link is missing.

[[interfaces/agent-skill-structree|Structree Skill]] carries this authoring guidance. It is a manual policy, not a synchronization implementation.

## Decision Provenance

.local/.progress/2026-10-25-1825-body-reference-sync.md:84 records the superseding owner instruction: “abort, do not add links from text automatically”. Lines 109-124 state that automatic extraction was canceled before implementation, only manual dual-authoring guidance was retained, and the code task was abandoned. Earlier automatic mapping proposals are rejected history, not pending requirements or authorization.

The inspected current .opencode/skills/structree/SKILL.md section Keep references in both metadata and prose explicitly prohibits automatic derivation/addition and automatic pruning. No automatic synchronization code or new runtime guarantee is claimed.
