---
id: an-id-is-a-legal-file-name
name: an id is a legal file name
title: An Id Is A Legal File Name
description: An id that cannot serve as a file name is refused.
createdAt: 2026-10-21T09:40:00.000Z
updatedAt: 2026-10-21T09:40:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: vault-file-naming
  dependsOn: []
---
## Statement
An id outside the domain is refused with VALIDATION: empty or blank, not lowercase, carrying a path separator, a dot component, a leading dot, a control character, an unpaired surrogate, a reserved device name, or longer than 200 UTF-8 bytes.
## How it is observed
Each rule has a refused example, and the refusal names the problem rather than storing the id. A file whose id is outside the domain is excluded with a scan issue and is neither indexed nor renamed.