---
id: json-config-invalid-values-rejected
name: json config invalid values rejected
title: Reject invalid configuration values
description: An unknown key, an invalid bound or a null section raises a FrameworkError with code CONFIG before serving starts.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: load-json-configuration
  dependsOn: []
---
## Statement
Reject invalid configuration values: An unknown key, an invalid bound or a null section raises a FrameworkError with code CONFIG before serving starts.
## How it is observed
defineConfig throws a FrameworkError whose code is CONFIG and whose message names the offending key.