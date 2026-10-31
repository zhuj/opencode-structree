---
id: registry-test
name: registry.test.ts
title: Registry Test
description: Checks base-field coverage analysis, decode-time validation and non-finite number rejection.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - sc-registry-missing-base-field
    - sc-registry-complete-schema
    - sc-registry-non-finite
  commitsTo:
    - object-definition
    - interface
---
## File
test/registry.test.ts
## What it covers
a schema that omits a required base field is rejected at registration | a schema that provides every base field is accepted at registration | a schema whose base field is optional is not reported as missing at registration | a decoded object that omits an optional base field is still rejected at decode time | a union of structs that each provide every base field is accepted at registration | a registered union decodes each member that provides every base field | a union with a member that omits a base field is rejected naming only that field | a union with a member the coverage analysis cannot understand is rejected | a schema without a metadata field names metadata instead of a JSON compatibility error | a schema that is not an object struct is rejected with the missing base fields | a non-finite decoded number is rejected with the offending field path | a finite numeric field is decoded and stored unchanged | a non-finite number nested under a relation names its full path | a non-finite number nested deeper than 32 levels is rejected with its full field path | a deeply nested but entirely finite value is accepted | a decoded object without a base field is rejected at decode time
## Verifies
registry-registration-validation, invalid-definition-rejected
## Exercises
object-definition, interface