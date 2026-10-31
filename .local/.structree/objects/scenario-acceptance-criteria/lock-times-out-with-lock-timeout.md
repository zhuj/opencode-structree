---
id: lock-times-out-with-lock-timeout
name: lock times out with lock timeout
title: Time out with lock_timeout
description: A wait that exceeds the configured timeout rejects with code LOCK_TIMEOUT and names the lock file.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: lock-timeout-and-cancellation
  dependsOn: []
---
## Statement
Time out with lock_timeout: A wait that exceeds the configured timeout rejects with code LOCK_TIMEOUT and names the lock file.
## How it is observed
The call rejects with code LOCK_TIMEOUT and the details name the lock file path.