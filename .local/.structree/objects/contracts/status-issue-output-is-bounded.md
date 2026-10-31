---
id: status-issue-output-is-bounded
name: The Status Report Bounds Its Issue List
title: The Status Report Bounds Its Issue List
description: A status report is a snapshot and stays small; the resync report keeps every issue.
createdAt: 2026-10-20T18:48:18.000Z
updatedAt: 2026-10-20T18:48:18.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - adr-advertise-effective-bounds-and-bound-status-output
---
## Rule
status() MUST bound the issue list, MUST report the total, whether the list was truncated and the count per code, and objects_resync MUST keep every issue.

## Evidence
`src/lib/framework.ts` builds the bounded view and leaves the stored report untouched.

## Why it matters
A repeated issue on every object turned one status call into a context-sized response; the bound keeps the snapshot readable without discarding the detail.