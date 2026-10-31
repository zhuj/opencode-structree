---
id: adr-run-cli-without-configuration-file
name: Run the CLI without a configuration file
title: Run The CLI Without A Configuration File
description: "Records accepted decision 0016: omitted --config uses built-in defaults plus the optional local override, not an implicit JSON file."
createdAt: 2026-10-28T10:22:05.129Z
updatedAt: 2026-10-28T10:22:05.129Z
retiredAt: null
tags:
  basis: existing-accepted-decision
metadata:
  decisionDate: 2026-10-21
  fileBindings:
    - root: project
      path: docs/decisions/0016-run-the-cli-without-a-configuration-file.md
      role: documentation
    - root: project
      path: src/cli.ts
      role: implementation
    - root: project
      path: src/lib/config.ts
      role: implementation
    - root: project
      path: test/config.test.ts
      role: test
    - root: project
      path: test/cli.test.ts
      role: test
relations:
  commitment:
    scenarios:
      - load-json-configuration
      - local-yaml-override-layer
  partOf: null
  dependsOn:
    - adr-configuration-layering
---
# Run The CLI Without A Configuration File

Last refreshed: 2026-10-28. This vault record summarizes the existing accepted decision dated 2026-10-21; its record creation timestamp is today, not a fabricated original decision timestamp.

## Recorded Context And Decision

Decision 0016 documents that requiring an implicitly named object-mcp.config.json prevented an otherwise configured-default project from starting. The accepted option makes --config optional: loadDefaultConfig uses complete built-in defaults, then applies the optional cwd-relative .local/.structree/config.yaml override. A JSON file is loaded only when explicitly selected; its internal relative paths keep their file-relative rule. This extends [[adrs/adr-configuration-layering|Configuration layering]].

## Alternatives Recorded By The Decision

Keeping the mandatory implicit JSON fallback or reading it only when present were rejected because effective configuration would depend on an unnamed file. The source decision records these reasons; no additional rationale is inferred here.

## Traceability

- [[scenarios/load-json-configuration|Load explicitly selected JSON configuration]]
- [[scenarios/local-yaml-override-layer|Apply the optional local override]]

## Current-Code Qualification

`src/cli.ts` still selects loadDefaultConfig when no --config is given. Later resilient serving no longer prepares embeddings during normal serve, so the historical negative consequence in decision 0016 about serve preparing a cold snapshot is not current serve behavior. Explicit maintenance sync still invokes preparation. The decision source is preserved rather than silently rewritten.

## Evidence And Limits

Source decision: `docs/decisions/0016-run-the-cli-without-a-configuration-file.md`. Implementation: `src/cli.ts`, `src/lib/config.ts`. Historical confirmation points to `test/config.test.ts` and `test/cli.test.ts`; those checks were not executed during this refresh.
