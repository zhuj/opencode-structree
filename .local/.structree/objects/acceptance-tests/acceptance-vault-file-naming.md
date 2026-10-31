---
id: acceptance-vault-file-naming
name: vault file naming acceptance
title: "Acceptance: Vault File Naming"
description: The scenario vault-file-naming is accepted when all of its criteria hold.
createdAt: 2026-10-21T09:40:00.000Z
updatedAt: 2026-10-21T09:40:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - an-id-is-always-lowercase
    - an-id-is-a-legal-file-name
    - a-created-object-is-stored-under-its-id
    - the-scanner-restores-a-name-that-disagrees
    - a-rename-never-overwrites
---
## Scenario
vault-file-naming - Vault File Naming
## Criteria covered
an-id-is-always-lowercase, an-id-is-a-legal-file-name, a-created-object-is-stored-under-its-id, the-scanner-restores-a-name-that-disagrees, a-rename-never-overwrites
## Evidence
test/framework.test.ts, test/vault-sync.test.ts, test/schemas.test.ts, docs/decisions/0013-name-the-file-after-the-id.md