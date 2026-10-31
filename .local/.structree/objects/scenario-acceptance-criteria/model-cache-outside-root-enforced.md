---
id: model-cache-outside-root-enforced
name: model cache outside root enforced
title: Reject a model cache inside the object root
description: An ONNX cacheDir inside the resolved root raises a CONFIG error.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: state-path-isolation-violation
  dependsOn:
    - default-state-paths-under-structree
---
## Statement
Reject a model cache inside the object root: An ONNX cacheDir inside the resolved root raises a CONFIG error.
## How it is observed
defineConfig throws a CONFIG error whose message states the model cache must be outside the object directory.