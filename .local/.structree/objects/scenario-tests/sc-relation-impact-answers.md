---
id: sc-relation-impact-answers
name: names what a change reaches and what justifies a change
title: Names What A Change Reaches And What Justifies A Change
description: Shows that a relation query returns the objects a change reaches, in both directions of the question, and that it reports the link defects it meets.
createdAt: 2026-10-22T06:03:50.000Z
updatedAt: 2026-10-22T06:03:50.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-agent-tool-surface-sweep
  commitsTo:
    - mcp-objects-relations
    - object-facade
---
## Test
names what a change reaches and what justifies a change
## File
test/relations.test.ts
## What it proves
A change to a decision reaches the objects that commit to it and, through them, the tests that
commit to those objects, and a change to a scenario reaches the decisions that commit to it. A
usage relation propagates along its stored edge, a link to a target of the wrong type is still
followed and is reported as a mismatch, a cycle is reported without being expanded, a diamond is
not reported as a cycle, and a retired object is reported by default and can be excluded.
## Criteria
a-relation-query-names-what-a-change-reaches