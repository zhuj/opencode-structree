---
id: a-deferred-startup-failure-is-reported-not-fatal
name: a deferred startup failure is reported not fatal
title: A Deferred Startup Failure Is Reported Not Fatal
description: A failure of the deferred startup is reported and the server keeps serving.
createdAt: 2026-10-21T11:20:00.000Z
updatedAt: 2026-10-21T11:20:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: resync-index-reconciliation
  dependsOn: []
---
## Statement
A failure of the deferred startup is delivered through the error channel, does not stop the server, and is still visible to a caller that waits for the startup.
## How it is observed
The error observer receives the failure, the server answers later requests, and the call that waits for the startup observes the same failure.