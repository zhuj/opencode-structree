---
id: adr-redacted-client-diagnostics
name: Redacted client diagnostics
title: Redacted Client Diagnostics
description: The vault codec no longer requests pretty YAML errors, so a parse failure reports the reason and position without quoting the user's source text into client-visible error details.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  commitment:
    scenarios:
      - mcp-tool-error-contract
      - cli-invalid-usage
  partOf: null
  dependsOn: []
---
## Context
This decision is recorded in the project's session memory in `.local/.memory/lessons/20261020-064502-diagnostics-may-quote-source-text.md`. The vault codec parsed frontmatter with the YAML library's pretty error mode left enabled, so a parse error message quoted the offending source region; those messages were retained as issue messages, placed in `SOURCE_CONFLICT.details.issues` and serialized unchanged by the MCP tool boundary, which carried a value from a user's Markdown file to the client. The defect was observed at commit `ed94d404` on 2026-10-19 and fixed on 2026-10-20.

## Decision
The vault codec no longer asks the YAML library for pretty errors, so a parse failure reports the reason and the position without quoting the source, and the sentinel value no longer appears in the client-visible error details. The accidental leak of file content is closed on 2026-10-20, while the product question of which identifier feedback is intentional is explicitly recorded as still open.

## Consequences
- A user no longer sees their own file content echoed back through `FrameworkError.details` and the MCP tool response by way of a YAML parse error.
- Deliberate identifier feedback, such as naming an unknown object type back to the caller, is unchanged, because the framework still cannot distinguish the two cases.
- The exposure depended on the error category, since a duplicate-key error quotes only the key lines, so only some YAML errors leaked values.
- The lesson is now a regression guard and must be revalidated after a change to the codec, to the error serialization, or to a decision about redaction.

## Evidence
- `.local/.memory/lessons/20261020-064502-diagnostics-may-quote-source-text.md`
- `src/lib/vault/codec.ts`, `src/lib/filesystem.ts` and `src/lib/mcp.ts`
- `.local/.progress/2026-10-19-2005-cross-validation.md`, `.local/.progress/2026-10-19-1527-review-evidence-2.json` and commit `96a3f93`