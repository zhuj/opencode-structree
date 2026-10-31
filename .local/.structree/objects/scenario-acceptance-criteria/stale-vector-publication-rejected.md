---
id: stale-vector-publication-rejected
name: stale vector publication rejected
title: Reject a stale vector publication
description: Replacing embeddings for a key whose source checksum changed returns false and leaves the previous vectors intact.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: stale-vector-rejection
  dependsOn: []
---
## Statement
Reject a stale vector publication: Replacing embeddings for a key whose source checksum changed returns false and leaves the previous vectors intact.
## How it is observed
replaceEmbeddings returns false and the stored embedding rows still carry the previous checksum.