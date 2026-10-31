---
id: adr-name-the-file-after-the-id
name: name the file after the id
title: Name The File After The Id
description: The object id is the file name, the id is always lowercase and restricted to a portable file name, and the scanner restores a name that disagrees with the id.
createdAt: 2026-10-21T09:40:00.000Z
updatedAt: 2026-10-21T09:40:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  commitment:
    scenarios:
      - vault-file-naming
      - markdown-frontmatter-round-trip
      - mcp-crud-tool-round-trip
  partOf: null
  dependsOn:
    - adr-filesystem-commit-and-reconciliation
---
## Context

The file name was a SHA-256 hash of the JSON-encoded id, a 70-byte ASCII basename that is a pure
function of the id. It was chosen so that an id could be any non-empty string without becoming a
path: the schema allowed every non-empty string, and the id "../../outside:project" was stored
verbatim while its file stayed "projects/id-<64 hex characters>.md".

The hash supplied properties rather than convenience: a fixed length, no separators, no leading dot,
ASCII-only output with no case or normalization equivalence, no reserved device name, and an id that
is never a path.

## Decision

The id is the file name. A created object is stored at "<type directory>/<id>.md".

The id domain is narrowed so the name is safe by construction. An id must not be empty or entirely
whitespace, must be lowercase, must contain no path separator, must be neither "." nor "..", must not
start with a dot, must contain no control character and no unpaired surrogate, must not be a Windows
reserved device name, and must not exceed 200 UTF-8 bytes.

The framework lowercases the object id and every relation identifier at the very start of create,
get, update and delete. Two ids that differ only in case are therefore one id, so the second create
is refused on every filesystem rather than colliding on some.

The reconciliation pass renames a discovered file whose base name is not "<id>.md", in the directory
it is already in, and updates the indexed path. The file content is the source of truth, so a name
that disagrees with the id in the file is corrected rather than trusted. A rename never overwrites: a
target that already exists excludes the object with a scan issue and leaves both files alone.

## Consequences

The name is no longer free: a file renamed by hand is renamed back by the next reconciliation, and
the indexed path follows it. Subdirectories are still supported, because only the base name is
corrected. A resync can now write to the source, so it is not a read-only operation. The ids already
in the vault satisfy the domain, so no object becomes invalid and the move from the hash names is the
reconciliation itself rather than a separate operation.