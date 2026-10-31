---
id: acceptance-vault-confinement-and-size-violations
name: vault violations acceptance
title: "Acceptance: Vault Confinement And Size Violations"
description: The scenario vault-confinement-and-size-violations is accepted when all of its criteria hold.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - vault-rejects-path-escape
    - vault-rejects-oversized-and-invalid-utf8
---
## Scenario
vault-confinement-and-size-violations - Vault Confinement And Size Violations
## Criteria covered
vault-rejects-path-escape, vault-rejects-oversized-and-invalid-utf8
## Evidence
test/vault.test.ts