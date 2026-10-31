---
id: vault-file-naming
name: vault file naming
title: Vault File Naming
description: A vault object is stored under its id, and the reconciliation keeps that name true.
createdAt: 2026-10-21T09:40:00.000Z
updatedAt: 2026-10-21T09:40:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  project: structree-initial
  partOf: null
  dependsOn: []
  commitment:
    features:
      - vault-file-object-model
      - mcp-tool-surface
      - sqlite-index-and-search
---
## Scenario

An object is created under a name that is its id, and the vault keeps it that way: the id is lowercase
and a legal file name, and the reconciliation renames a file whose name has drifted from the id
inside it.

## Expected behaviour
A create with a mixed-case id stores the lowercase id under "<id>.md". A get, update or delete with a
mixed-case id finds that object. A file renamed by hand, or one left with the name of an earlier
encoding, is renamed back and the indexed path follows.

## Failure modes
An id outside the domain is refused with VALIDATION, a file whose id is outside the domain is excluded
with a scan issue, and a rename whose target name is taken leaves both files alone and reports an
issue rather than overwriting either.

## Covered by
an-id-is-always-lowercase, an-id-is-a-legal-file-name, a-created-object-is-stored-under-its-id, the-scanner-restores-a-name-that-disagrees, a-rename-never-overwrites