---
id: yaml-override-applies-last
name: yaml override applies last
title: Apply the yaml layer last
description: A value in the local YAML file replaces the same key of the JSON configuration and of the built-in defaults.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: local-yaml-override-layer
  dependsOn:
    - json-config-provider-defaults-merged
---
## Statement
Apply the yaml layer last: A value in the local YAML file replaces the same key of the JSON configuration and of the built-in defaults.
## How it is observed
The returned configuration holds the YAML value for the overridden key and the lower layer value for every other key.