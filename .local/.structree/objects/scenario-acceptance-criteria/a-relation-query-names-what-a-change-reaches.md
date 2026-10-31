---
id: a-relation-query-names-what-a-change-reaches
name: a relation query names what a change reaches
title: A Relation Query Names What A Change Reaches
description: A relation query returns the objects a change reaches, with the kind and the distance that reached each one, and it reports the link defects it meets.
createdAt: 2026-10-22T06:03:50.000Z
updatedAt: 2026-10-22T06:03:50.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: agent-tool-surface-sweep
  dependsOn: []
---
## Statement

A relation query names what a change reaches: the impact mode returns the affected set with the
relation kind and the distance that reached each object, and the findings report the link defects
the model does not prevent.

## How it is observed

A change to a decision reaches the contracts, interfaces and entities that commit to it, and
through them the tests that commit to those objects. A change to a scenario reaches the decisions
that commit to the scenario. A link to a target of the wrong type is still followed and is reported
as a mismatch, and a cycle is reported without being expanded.