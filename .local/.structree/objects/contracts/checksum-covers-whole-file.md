---
id: checksum-covers-whole-file
name: Checksum Covers The Whole File
title: Checksum Covers The Whole File
description: A checksum identifies the exact bytes of a source file.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - adr-filesystem-commit-and-reconciliation
---
## Rule
The checksum MUST be the lowercase hexadecimal SHA-256 digest of the entire decoded source file, including the frontmatter and the body, and MUST NOT be computed over a normalized or re-serialized form.
## Evidence
src/lib/vault/checksums.ts:3-4; src/lib/vault/codec.ts:89; src/lib/vault/codec.ts:103
## Why it matters
Only a whole-file digest detects an edit that touches any byte of the object.