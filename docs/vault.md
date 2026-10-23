# Vault and storage abstractions

The vault owns a directory of Markdown documents. Validated documents have a typed
YAML header, an exact Markdown body, a logical relative path, and a checksum of
the complete source. Readable documents with missing, broken, or incomplete
frontmatter remain available as partial content with diagnostics. A caller supplies
the header codec. Object registrations,
relationships, SQL tables, MCP transports, and embedding providers are composed
above this layer.

## Ideas adopted from the supplied storage files

| Supplied modules | Adopted implementation | Adaptation |
| --- | --- | --- |
| `vault.ts`, `projection-codec.ts` | `Vault<Header>` and `MarkdownCodec<Header>` | Inject a header codec instead of node/edge schemas. Effect codecs remain authoritative for application headers. Body whitespace is preserved. |
| `confined-directory.ts`, `confined-filesystem.ts` | `ConfinedFilesystem` and its directory-handle implementation | Validate every logical path; reject symlinked descendants; pin directory descriptors on Linux/procfs with an explicit portable fallback. Reads are bounded and reject invalid UTF-8. |
| `owned-stage.ts` | `OwnedStage` | Retain the parent/temporary inode through publication and cleanup; verify both identity and payload; preserve destination permissions; use atomic no-clobber creation. |
| `projection-files.ts`, `projection-publisher.ts` | `stage`/`publish`, checksum expectations, mutation serialization, and draining | Use guarded filesystem publication. Markdown remains the source of truth; derived SQL work follows successful source commits. |
| `watcher.ts`, `watch-lifecycle.ts` | `FileWatcher` and `WatchLifecycle<Report>` | Retain Chokidar's existing backend; wait for readiness before the first scan; coalesce changes and separate caller cancellation from shared reconciliation. |
| `reconciliation.ts` | `reconcileSnapshot` plus the object adapter/framework | Separate discovery from applying derived changes. Validate identities before applying a snapshot, and infer deletion only from complete discovery. |
| `checksums.ts` | `checksum` plus existing cache metadata | Reuse the existing `(type,id)` key, source path, and checksum columns. No second checksum database is necessary. |
| `caching.ts` | Existing checksum/fingerprint publication checks | Carry forward the idea that asynchronous results need a freshness guard. SQLite change stamps and TTLs cannot validate externally edited source files, so authoritative reads continue to read their bytes. |
| Storage `index.ts` | `FileStore` and `ObjectFramework` composition | Keep domain mappings in registrations. Tool events, source notifications, and synchronization reports share one facade lifecycle. |

The supplied projection journal implements a database-authoritative recovery
policy in parts of its storage facade. This project retains the user's original
filesystem-authoritative contract: startup and notifications import current
Markdown into rebuildable indexes. SQL never replays an older object over an
external edit. The supplied node/edge, graph-scope, archive, and mutation-service
models are outside the adopted vault abstraction.

## Direct use with Effect

```ts
import { ConfinedFilesystem, MarkdownCodec, Vault } from "@local/object-mcp/vault";
import { Schema } from "effect";

const Header = Schema.Struct({
  slug: Schema.String,
  enabled: Schema.Boolean,
  labels: Schema.Array(Schema.String),
});

const codec = new MarkdownCodec<typeof Header.Type>({
  decode: Schema.decodeUnknownSync(Header, { onExcessProperty: "error" }),
  encode: (header) => Schema.encodeSync(Header)(header),
});

const files = new ConfinedFilesystem("/my/workspace/recipes", {
  maxFileBytes: 5_000_000,
  confinement: "auto",
});
await files.initialize();
const vault = new Vault(files, codec);

try {
  const created = await vault.create(
    "guides/import.md",
    { slug: "import", enabled: true, labels: ["guide"] },
    "# Import guide\n\nKeep this trailing whitespace.  \n",
  );
  const current = await vault.read(created.path);
  if (current.partial) {
    console.log(current.raw, current.issues);
  } else {
    await vault.update(
      current.path,
      { ...current.header, labels: ["guide", "reviewed"] },
      current.body,
      current.checksum,
    );
  }
} finally {
  await files.close();
}
```

The typechecked [standalone example](../examples/vault.ts) exports a reusable
factory. Its header has no BaseObject, entity ID, or `relations` requirement.
For Date transforms, use `Schema.toCodecJson` and an encoder that returns a
mapping. The header decoder determines whether callers supply encoded JSON,
decoded domain values, or both. FileStore's registry codec accepts both.

## APIs and ownership

| API | Behavior |
| --- | --- |
| `new ConfinedFilesystem(root, options)` | Owns directory handles, path validation, bounded reads, mutation ordering, and active-operation leases. |
| `initialize()` | Creates/resolves the trusted configured root and opens its handle; concurrent initialization shares one result. |
| `ensureDirectory(path, create?)` | Opens every descendant component without accepting symlinked directories; optionally creates missing components. |
| `readText(path, signal?)` | Returns current, strictly decoded UTF-8 source within the configured byte limit. |
| `hash(path, signal?)` | Hashes current file bytes; returns `null` for absence. |
| `walk(directory?, signal?)` | Discovers visible `.md` files recursively and returns files, issues, scanned count, and a completeness flag. |
| `stage(path, raw, signal?)` | Writes/fsyncs an owned temporary inode. The caller must clean up the returned stage. |
| `publish(stage, expectation, signal?)` | Consumes a stage once, verifies source expectation and stage ownership/payload, and publishes it. |
| `write(path, raw, expectation, signal?)` | Handles staging, publication, and cleanup in one operation. |
| `delete(path, expectedChecksum, signal?)` | Verifies current bytes before removing a regular file and syncing its parent. |
| `close()` | Stops new operations and waits for retained file/stage operations before closing the root. Idempotent and asynchronous. |
| `new MarkdownCodec(headerCodec, options)` | Converts between YAML/Markdown and typed headers, with configurable byte and alias limits. |
| `new Vault(files, codec)` | A typed document view over shared filesystem ownership. |
| `Vault.read/parse/scan` | Return discriminated validated/partial documents; parsing problems are nonfatal diagnostics, not omitted source files. |
| `Vault.create/update/write` | Validate the complete header before publication; `write` accepts an explicit expectation. |
| `Vault.delete` | Delete the explicit relative path under the supplied checksum guard. Object-facade mutation policy is enforced above this generic layer. |

`VaultDocument<Header>` is a validated/partial union. Both branches contain
`header`, `body`, `raw`, `json`, `path`, and `checksum`. The validated branch
has the decoded `Header`; a partial branch has `partial: true`, `header: null`,
JSON-compatible recovered `json`, and structured `issues`. Narrow on `partial`
before using `header`. `ValidVaultDocument<Header>` names the validated shape
returned by strict serialization and publication. Multiple vault views may share
one `ConfinedFilesystem`, for example
one view per registered object schema. The outer owner closes the shared files
once all views and asynchronous work have finished.

Create uses `{expectedChecksum: null}` and requires an absent destination.
Update uses the checksum from a previous read and requires that exact existing
revision. There is no unconditional overwrite default. Explicit stage users
must use `try/finally { await stage.cleanup(); }`, including after a rejected
publication. A stage is one-use even when its publication fails. A retained,
uncleaned stage keeps `files.close()` waiting; automatic `write/create/update`
operations own this cleanup for callers.

Vault paths use `/` separators and include the desired filename extension.
Traversal, absolute paths, empty components, backslashes, NULs, Windows drive
forms, and malformed UTF-16 are rejected. Scans include `.md` case-insensitively
and exclude hidden names, including staging files. Filename extensions are
explicit; the API does not append `.md` silently.

### Read-contract amendment, 2026-10-23

Tolerant reads amend the earlier strict-discovery assumptions in
[decision 0001](decisions/0001-filesystem-commit-and-reconciliation.md) and the
validated-only scope of filename alignment in
[decision 0013](decisions/0013-name-the-file-after-the-id.md). Those records remain
historical evidence, not instructions to omit or rename partial documents.
Deferred startup and reconciliation scheduling from
[decision 0015](decisions/0015-defer-the-startup-reconciliation.md) are unchanged.
The [facade contract](library.md#partial-reads-strict-writes) defines inferred
identity, recovered metadata, mutation refusal, and qualified relation answers.

Parser/schema warnings alone do not make filesystem discovery incomplete or
prevent readable documents from reaching the index. Genuine I/O failures and
duplicate identities still retain their conflict/completeness semantics. This
amendment does not loosen strict writes or authorize automatic source repair.

## Publication and filesystem limits

Temporary files start with mode `0600`. Publication checks the temporary name
still identifies the owned inode and verifies its stored bytes. Creating a new
file uses a hard link so an existing destination cannot be overwritten. Updating
an existing file preserves its ordinary permission bits and renames the complete
stage over the destination. Directory synchronization follows publication.

Cleanup checks that a temporary name still belongs to the owned inode. A
substituted name is left intact. In portable mode, an observed replaced parent
prevents path-based cleanup from touching the substituted directory. A process
crash can leave a hidden orphan stage; discovery ignores it, and startup does not
blindly delete staging names that could belong to another process.

Confinement modes are `auto`, `descriptor`, and `portable`. Auto selects held
directory descriptors when Linux/procfs capabilities are available. Descriptor
mode requires them explicitly. Portable mode uses path checks and directory/file
identity comparisons. `files.confinement` reports `descriptor` or `path` after
initialization. The configured root is trusted and canonicalized once; root
aliases are resolved at that boundary. Descendant symlinks are excluded.

The object framework exposes this choice through `sync.confinement`, also
defaulting to `auto`. Existing partial configurations receive that default;
`descriptor` makes a missing Linux/procfs capability an initialization error.

Held descriptors reduce path substitution races but do not establish an
OS-enforced sandbox against hostile directory relocation, hardlink insertion,
or mount changes. Portable path checks have a wider check/use race window. The
implementation assumes a trusted root and cooperative ordinary editors. Both
descriptor mode and forced portable mode are tested on Linux; other operating
systems were not exercised in this verification run.

Checksum checks detect stale revisions and the per-filesystem queue serializes
local publications/deletions. Separate instances/processes need shared
coordination for the same guarantee. The object framework supplies
`SqliteProcessLock`; direct vault hosts can use that exported utility or another
coordinator. External editors do not acquire this lock and can race the final
check and rename/unlink. No filesystem API here promises universal
compare-and-swap against arbitrary writers.

Direct vault hosts can use the same process coordination utility:

```ts
import { SqliteProcessLock } from "@local/object-mcp/sqlite";

const lock = await SqliteProcessLock.open({
  path: "/my/workspace/recipes/.coordination.sqlite",
  driver: "better-sqlite3",
  timeoutMs: 10_000,
  retryIntervalMs: 50,
});

try {
  await lock.run(async () => {
    const current = await vault.read("guides/import.md");
    if (current.partial) throw new Error("Repair the partial header before this update.");
    return vault.update(
      current.path,
      { ...current.header, enabled: false },
      current.body,
      current.checksum,
    );
  });
} finally {
  await lock.close();
}
```

Use a dedicated coordination file. Each lock instance serializes its own
callbacks and retries SQLite contention asynchronously. `run(work, signal)` can
cancel queued/busy waits without invoking the callback. Once a callback starts,
its lock remains held until it actually settles; the callback can pass the same
signal to its file operations. `close()` rejects new calls and drains already
accepted callbacks. The lock is not reentrant: a callback must not await another
`run` on the same instance. The `bun` driver is also supported.

The Markdown codec preserves body whitespace and hashes BOM/line-ending bytes
as supplied. Tolerant reads report malformed frontmatter, duplicate YAML keys,
and header validation problems without suppressing the readable document; they
do not treat recovered values as a validated header. Missing frontmatter leaves
the complete Markdown available as content. Unterminated frontmatter preserves
the original source rather than discarding the apparent header. Alias expansion
remains bounded. Invalid
UTF-8 files remain unchanged and are reported by scans. Raw strings/bodies with
unpaired UTF-16 surrogates are rejected before writing because UTF-8 cannot
represent them faithfully. YAML-escaped header strings can preserve those
values. Full replacements rewrite frontmatter comments and formatting.

## Watcher, reconciliation, and deferred work

`FileWatcher` produces relative add/change/unlink and directory events. It is a
discovery hint source, not a database mutation listener. `WatchLifecycle` accepts
a caller-supplied asynchronous reconciliation function and owns its scheduling.
It waits for watcher readiness before the first scan, debounces idle changes,
coalesces concurrent resync calls, and repeats a pass when changes arrive during
active work. The default bound is five passes per batch; remaining dirty work
moves to another scheduled batch. A configurable periodic scan repairs missed
notifications.

Each `resync(signal)` caller can cancel its own wait. The shared reconciliation
continues for other callers. The host owns cancellation of actual filesystem and
provider work, and must abort that lifecycle before awaiting scheduler shutdown.
Shutdown drains started work even if another worker or watcher closure fails.
Framework cleanup then attempts every remaining resource and reports combined
cleanup failures.

`reconcileSnapshot` preflights duplicate keys before invoking an upsert callback.
It removes missing derived rows only when `complete` is true, and only after all
upserts return successfully. The caller owns the transaction or coordination
boundary. In this framework FileStore retains readable partial documents and
excludes duplicate object identities; reconciliation applies recoverable metadata
and text under its source coordination lock. Partial files are never automatically
repaired or renamed, and their inferred filename identities are not persisted.
A partial directory enumeration cannot establish absence for unseen objects.

A confirmed conflict and an unobserved object are different cases. When the
scan positively identifies a duplicate identity, that key is invalidated
immediately and its derived rows are removed, even if another directory was
enumerated only partially. An object that was merely not observed keeps its
cached row until a complete scan establishes that it is gone.

Embedding inference remains outside filesystem locks and search transactions.
Before vectors are published, the framework rereads the source checksum and
checks the indexed source revision. A changed source schedules another pass.
The existing metadata table already stores identity, path, and checksum, so
introducing another checksum store would add another state copy to reconcile.
Source reads also stay independent of SQLite-stamped or TTL caches: a text editor
can change a file without any SQLite transaction.

See [ADR 0006](decisions/0006-extract-library-and-adopt-vault.md),
[the library boundary](library.md), [the database guide](database.md), and
[validation evidence](validation.md).
