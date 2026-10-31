---
id: embedding-device-unavailable
name: embedding device unavailable
title: Report an unusable execution device
description: An ONNX backend that cannot be initialized fails with code DEVICE_UNAVAILABLE instead of an opaque runtime error.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: embedding-provider-failures
  dependsOn: []
---
## Statement
Report an unusable execution device: An ONNX backend that cannot be initialized fails with code DEVICE_UNAVAILABLE instead of an opaque runtime error.
## How it is observed
The call rejects with code DEVICE_UNAVAILABLE and its message names the CUDA runtime libraries or the cpu device.