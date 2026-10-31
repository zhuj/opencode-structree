---
id: json-config-provider-defaults-merged
name: json config provider defaults merged
title: Merge provider defaults
description: defineConfig with a provider override applies that provider's own default fields next to the shared defaults.
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
Merge provider defaults: defineConfig with a provider override applies that provider's own default fields next to the shared defaults.
## How it is observed
The resolved configuration exposes the OpenAI provider defaults for every field the caller did not set.