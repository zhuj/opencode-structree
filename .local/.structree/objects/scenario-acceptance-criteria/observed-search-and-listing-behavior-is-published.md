---
id: observed-search-and-listing-behavior-is-published
name: observed search and listing behavior is published
title: Observed Search And Listing Behavior Is Published
description: The published surface names the error class of a lexical overflow, states the hybrid fallback, and states that a retired object is still listed and searchable.
createdAt: 2026-10-21T07:05:00.000Z
updatedAt: 2026-10-21T07:05:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: identifier-and-surface-restrictions
  dependsOn: []
---
## Statement
The published surface states the observed behavior: a query above the 128-token cap fails with `INTERNAL`, a hybrid query with no lexical tokens still runs the semantic ranking, and a retired object is still listed and still searchable.
## How it is observed
The `objects_search` query description names `INTERNAL`, the mode description states the hybrid fallback, the per-type list description states the retired-object rule, and the `retiredAt` field description says a retired object is still listed and searchable.