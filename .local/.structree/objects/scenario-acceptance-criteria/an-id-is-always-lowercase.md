---
id: an-id-is-always-lowercase
name: an id is always lowercase
title: An Id Is Always Lowercase
description: The framework lowercases the object id and every relation identifier before it does anything else.
createdAt: 2026-10-21T09:40:00.000Z
updatedAt: 2026-10-21T09:40:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: vault-file-naming
  dependsOn: []
---
## Statement
The framework lowercases the object id and every relation identifier at the very start of create, get, update and delete, so an id is always lowercase.
## How it is observed
A create with a mixed-case id stores the lowercase id, a get with the mixed-case form finds it, and a relation identifier given in mixed case is stored lowercase.