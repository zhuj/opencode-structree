---
id: the-file-name-is-the-id-and-the-scanner-restores-it
name: the file name is the id and the scanner restores it
title: The File Name Is The Id And The Scanner Restores It
description: Creation uses normalized ID filenames; maintenance may align validated filenames, while partial/projection reads do not.
createdAt: 2026-10-21T09:40:00.000Z
updatedAt: 2026-10-28T10:21:39.894Z
retiredAt: null
tags: {}
metadata:
  reviewedHead: 7a507b1b65338daae338ec6c1fb83d5fbff8dfd2
  fileBindings:
    - root: project
      path: src/lib/framework.ts
      role: implementation
    - root: project
      path: src/lib/filesystem.ts
      role: implementation
    - root: project
      path: README.md
      role: documentation
    - root: project
      path: docs/recovery.md
      role: documentation
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - adr-name-the-file-after-the-id
---
# The File Name Is The Id And The Scanner Restores It

Last refreshed: 2026-10-28. Stable identity and original creation timestamp retained.

## Current Behavior

Typed creation stores <type directory>/<normalized id>.md. Maintenance reconciliation may correct a validated basename in its existing directory and updates the indexed path; it never overwrites a different target file. Same-file aliases are not a rename conflict. Partial sources are retained without name repair and may use inferred filename identity only for reads. Normal serve projection reconciliation and read-only source scans do not align filenames. Thus maintenance resync can mutate source names, but that is not a universal property of every resync/read composition.

## Typed References

- [[adrs/adr-name-the-file-after-the-id|adr-name-the-file-after-the-id]]

## Source Evidence

- implementation: `src/lib/framework.ts`
- implementation: `src/lib/filesystem.ts`
- documentation: `README.md`
- documentation: `docs/recovery.md`

This refresh uses static source evidence; no tests, runtime recovery or model operations were run. Historical decision rationale is not newly invented or retroactively approved.
