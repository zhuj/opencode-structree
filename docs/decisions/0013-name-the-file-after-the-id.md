---
status: accepted
date: "2026-10-21"
decision-makers:
  - User
consulted: []
informed: []
supersedes: []
superseded-by: []
---

# 0013. Name the file after the id

## Decision summary

Restrict stored object ids to a lowercase portable filename domain and store a
created object at `<type directory>/<id>.md`. Callers may send any case; lowercase
object and relation identifiers below the tool boundary before applying the
domain. Reconciliation corrects a file base name that disagrees
with the id in its content, without overwriting an existing target. The file
content remains the source of truth; a resync can rename source files.

## Context and problem statement

The previous file name was a SHA-256 hash of the JSON-encoded id:
`id-<64 hex characters>.md`, a 70-byte ASCII basename. The schema allowed any
non-empty string. The hash let an id be any such string without ever becoming
a path. An existing test proved that `../../outside:project` was stored verbatim
while its file stayed `projects/id-<64 hex characters>.md`.

The hash supplied fixed length, no separators, no leading dot, ASCII-only output
with no case or normalization equivalence, no reserved device name, and an id
that was never a path. Those were properties of the imposed file naming shape,
not SQLite or filesystem limits. Removing the hash requires an explicit domain
for the id itself rather than assuming an arbitrary string is a safe basename.

The owner chose to narrow that domain instead of retaining a second naming
scheme after the alternatives were measured. The vault is filesystem-authoritative,
and the file content is authoritative over its name as well. Correcting the name
to the id preserves that direction of authority.

## Decision drivers

- Make the file name the same handle used by tools, relations and readers.
- Put filename safety in the id domain rather than in a second naming scheme.
- Resolve case collisions consistently on every filesystem.
- Preserve the content as the source of truth and subdirectory placement.
- Never overwrite a file when correcting a discovered name.
- Let reconciliation perform the transition without a separate migration step.

## Considered options

1. **Keep the hash.** Rejected. It preserves arbitrary non-empty ids and its
   fixed ASCII shape, but leaves an unreadable second name for every object.
2. **Use a readable sanitized slug plus a short digest.** Rejected. It improves
   readability but retains a second naming scheme, sanitization rules and a
   digest instead of making the file name the id.
3. **Restrict the stored-id domain and name the file after the id.** Selected. The id
   itself supplies a bounded, separator-free, non-hidden, non-device filename
   component. Callers may send any case; lowercasing before domain validation
   resolves case-only collisions before persistence.

## Decision outcome

A caller may send an id in any case. It is lowercased first, and the lowercased
form is checked against the domain. An id is refused only if that form breaks a
rule. The stored id MUST satisfy all of these:

1. It is not empty and not entirely whitespace.
2. It is lowercase: the id equals its own lowercase form.
3. It contains no `/` and no `\`.
4. It is neither `.` nor `..`.
5. It does not start with `.`.
6. It contains no character below U+0020 and none equal to U+007F.
7. It contains no unpaired UTF-16 surrogate.
8. It is not a Windows reserved device name: `con`, `prn`, `aux`, `nul`, `com1`
   through `com9`, or `lpt1` through `lpt9`.
9. Its UTF-8 encoding is at most 200 bytes.

The domain replaces the hash's safety properties with constraints on the stored id
itself. It uses a byte bound rather than fixed length and lowercase rather than
ASCII-only output; it does not add Unicode normalization. The id is a filename
component, not an arbitrary path.

The framework lowercases the object id and every relation identifier at the very
start of create, get, update and delete. This normalization is below the tool
boundary, so the tools and library agree. A create with `MyThing` stores
`mything`, and a get with `MyThing` finds it. Two ids differing only in case are
one id: the second create is refused with `ALREADY_EXISTS` on every filesystem,
rather than colliding only on some filesystems.

An id read from a file is checked as written. A hand-written file whose
frontmatter id is not lowercase is an invalid object reported as a scan issue,
not normalized. The framework normalizes what it writes but reports what a human
wrote rather than rewriting authoritative file content.

A created object is stored at `<type directory>/<id>.md`. Reconciliation renames
a discovered file whose base name is not `<id>.md` in the directory it is already
in and updates the indexed path. The content is the source of truth, so the name
is corrected to match the id in it, not the other way round. A filesystem that
folds case or normalizes names may spell the name differently while the target
still names the same file. The scanner accepts that spelling, leaves the file
unchanged and indexed at its actual path, and reports no issue. For example,
`MyThing.md` may already be the same file as the target `mything.md` on a
case-folding filesystem, and a non-ASCII name may have a filesystem-normalized
spelling.

The scanner checks the target's device and inode identity through the confined
filesystem. When it is the same file, no rename is necessary. Rename publication
uses an exclusive hard link, so it never overwrites: only a different file
holding the target name is a conflict, excluding the object with `RENAME_CONFLICT`
and leaving both files unchanged.

The published naming guidance is:

> Object ids are stable, unique within their type, and are the only handle: the file name is the id, an id is always lowercase, and the scanner renames a file whose name does not match its id.

The `type:id` cache-key encoding from [decision 0012](0012-use-a-type-id-cache-key.md)
is unchanged. This decision changes the source file name and the object id domain,
not the cache-key format or the generic SQLite table API.

## Consequences

### Positive

- A reader can identify a file by its object id without computing a digest.
- A caller may send an id in any case; tools and library calls lowercase it
  before checking the stored-id domain, independent of filesystem case behavior.
- Subdirectories remain supported because only the base name is corrected.
- The measured vault already satisfies the domain, so no existing object becomes
  invalid. Reconciliation itself renames the files; there is no separate migration.
- A conflicting target is preserved rather than overwritten.

### Negative

- The stored id can no longer be an arbitrary non-empty string, and two case-only
  spellings cannot identify different objects within a type.
- The file name is no longer free: a hand-renamed file is renamed back by the
  next reconciliation, and the indexed path follows.
- A resync can rename source files and is not a read-only operation.
- A different file holding the target name excludes the object with
  `RENAME_CONFLICT` until it is resolved;
  reconciliation leaves both files unchanged.

## Confirmation

The contract and vault measurement were supplied by the parent session as the
accepted specification on 2026-10-21. All 336 existing ids satisfy the domain:
none is empty or blank, contains a separator or control character, or starts with
a dot; the longest is 57 UTF-8 bytes, and all are distinct even when case-folded.
No existing object becomes invalid, and reconciliation is the migration itself.
This documentation lane did not access the live vault or repeat the measurement.

Static searches check current naming claims in the README, documentation and
structree skill. Decisions 0001 through 0012 remain unchanged as historical
records. No tests, resync, source-file renames, vault writes or runtime checks
were performed by this lane; the parent session owns implementation verification.

## Links

- [Core id domain and tool surface](../core-schemas.md#shared-fields).
- [File format and CRUD semantics](../../README.md#file-format-and-crud-semantics).
- [Database keys](../database.md#crud-and-keys).
- [Previous cache-key decision](0012-use-a-type-id-cache-key.md).
- [Historical tool-surface decision](0007-advertise-effective-bounds-and-bound-status-output.md).
