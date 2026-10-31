---
id: object-id-is-a-portable-lowercase-file-name
name: object id is a portable lowercase file name
title: Object Id Is A Portable Lowercase File Name
description: An id is always lowercase and restricted to a name that can be a file name on any filesystem.
createdAt: 2026-10-21T09:40:00.000Z
updatedAt: 2026-10-21T09:40:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - adr-name-the-file-after-the-id
---
## Rule
An object id MUST be lowercase and MUST be a name that can serve as a file name on any filesystem.

An id MUST NOT be empty or entirely whitespace. It MUST equal its own lowercase form. It MUST contain no path separator, no control character and no unpaired UTF-16 surrogate. It MUST be neither "." nor "..", MUST NOT start with a dot, MUST NOT be a Windows reserved device name, and MUST NOT exceed 200 UTF-8 bytes.

The framework MUST lowercase the object id and every relation identifier at the start of create, get, update and delete, so the tools and the library agree. A create with a mixed-case id MUST store the lowercase id, and a get, update or delete with a mixed-case id MUST find that object.

An id outside the domain MUST be refused with VALIDATION, both by the shared identifier schema and by the creation path, because a registered custom type may supply its own identifier schema.

## Why it matters
The file name is the id, so the id has to be a legal file name on the filesystem that holds the vault, and a case-insensitive filesystem must not be able to collapse two distinct ids into one file.

## Evidence
test/schemas.test.ts for the domain, test/framework.test.ts for the normalization and the refusal