---
id: a-rename-never-overwrites
name: a rename never overwrites
title: A Rename Never Overwrites
description: A rename whose target name is already taken leaves both files alone and reports an issue.
createdAt: 2026-10-21T09:40:00.000Z
updatedAt: 2026-10-21T10:20:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: vault-file-naming
  dependsOn: []
---
## Statement
A rename MUST NOT overwrite. If a different file already holds the target name, the object is excluded with a scan issue and both files are left as they are. A target that already names the same file is accepted as the name the filesystem gives that file: the object stays indexed and no issue is reported.
## How it is observed
The conflicting file keeps its content, the other file is untouched, and the reconciliation report carries an issue that names the condition. A file whose target name is the same file keeps its name and stays indexed without an issue.