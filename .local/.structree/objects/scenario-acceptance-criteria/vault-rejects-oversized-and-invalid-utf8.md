---
id: vault-rejects-oversized-and-invalid-utf8
name: vault rejects oversized and invalid utf8
title: Reject oversized and invalid utf8 files
description: A file above maxFileBytes or one that is not valid UTF-8 is excluded from the scan and reported as an issue.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: vault-confinement-and-size-violations
  dependsOn: []
---
## Statement
Reject oversized and invalid utf8 files: A file above maxFileBytes or one that is not valid UTF-8 is excluded from the scan and reported as an issue.
## How it is observed
The scan result carries an issue whose code names the file and its documents list omits that file.