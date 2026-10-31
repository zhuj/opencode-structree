---
id: lock-cancels-queued-waiter
name: lock cancels queued waiter
title: Cancel a queued waiter
description: Aborting a queued waiter rejects it promptly without invoking the protected callback.
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
Cancel a queued waiter: Aborting a queued waiter rejects it promptly without invoking the protected callback.
## How it is observed
The queued promise rejects with the abort reason and its callback is never entered.