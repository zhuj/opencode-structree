---
id: a-created-object-is-stored-under-its-id
name: a created object is stored under its id
title: A Created Object Is Stored Under Its Id
description: A created object is stored at <type directory>/<id>.md.
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
A created object is stored at "<type directory>/<id>.md" with the normalized id.
## How it is observed
The path of a created object is the type's directory followed by the lowercase id and ".md".