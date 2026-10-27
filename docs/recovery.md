# Recovery And Resilient Access

## Delivery Status

All four stages are implemented and verified within the limits in this guide.
Independent phase reviews and parent regressions resolved the reported safety
concerns. Final validation on 2026-10-27 passed lint, typecheck and 882 tests, with
two optional real-ONNX skips and no failures. Source and freshly built bundle
stdio smoke passed with 71 tools after the harness explicitly created its source
root and awaited projection resync for indexed-excerpt assertions. No real
OpenCode host, model or actual project-cache recovery was run. Persistent cache
recovery remains disabled unless a trusted host explicitly admits it.

| Order | Capability | Gate |
| --- | --- | --- |
| 1 | Independent Bun path/byte reader and bounded directory listing | Exact bytes, confinement, revision honesty, no optional dependencies or scaffolding |
| 2 | Resilient normal reads and nonpersistent fallbacks/retries | Honest partial coverage and optional-capability isolation |
| 3 | Diagnosis-only doctor CLI/MCP | Independent bounded probes, safe partial reports and no repair side effects |
| 4 | Explicit source repair/drafts, then opt-in dedicated-cache recovery | Revision, backup, coordination, ownership and publication safeguards |

The central rule is **relax semantic admission, not source preservation**.
Reading source bytes, interpreting metadata, resolving identity, proving global
consistency, committing source and publishing derived state are separate claims.
An unavailable interpretation or index must not remove access to otherwise
readable authorized content.

Missing bytes, denied OS access, failed storage, a broken Bun executable and a
dead transport remain real limits. Recovery does not bypass authorization or
fabricate content. A separate executable can survive normal application
bootstrap failure; it cannot make a dead MCP transport deliver a response.

## Independent Source Access

The independent source module and entry point are `src/lib/recovery/index.ts`
and `src/recovery-cli.ts`. Their byte-reading path must require only Bun/standard
library facilities and dependency-free confinement helpers. It must not require
configuration parsing, a registry/plugin, YAML, SQLite/native extensions, a model,
a watcher or the MCP SDK.

The operator selects an existing root explicitly. Opening that root must not
create directories, databases, caches or metadata. MCP adapters use a
host-selected authorized root; a tool caller cannot supply an arbitrary root.
Actual path spelling is preserved. Relative-path confinement and no-follow/file
identity checks remain independent of schema or object-ID validity.

Byte reads are bounded pages, not whole-file parsing with a larger memory cap.
Responses distinguish returned byte ranges, continuation/EOF, observed file
revision and page checksum. A page checksum is not a whole-file checksum.
Base64 preserves exact bytes; text decoding is optional and must not silently
replace invalid sequences. A range beginning inside a multibyte character does
not establish that the entire source file is invalid UTF-8.

### Current Stage 1 Commands

```bash
bun run recover read --root /explicit/existing/vault --path notes/broken.md --offset 0 --limit 65536
bun run recover read --root /explicit/existing/vault --path notes/broken.md --text utf8-fatal
bun run recover list --root /explicit/existing/vault --path notes --limit 100
```

The standalone entry is `bun src/recovery-cli.ts`; the build includes
`dist/recovery-cli.js` separately from the ordinary application entry. JSON goes
to stdout. Exit codes are `0` for an `ok` page, `2` for a `partial` page and `1`
for a failed operation/usage error. These are recovery-reader exits, not the
doctor report exits below.

Read options are `--offset`, `--limit`, `--text none|utf8-fatal|utf8-lossy` and
`--expected-revision TOKEN`. The default is exact bytes without text decoding,
with a 64 KiB page budget and 1 MiB maximum. List options are `--path`,
`--offset`, `--limit` and `--expected-revision TOKEN`; limits default to 100
entries with a maximum of 1,000. Replayed offset plus page/lookahead is bounded
to 100,000 entries. If that bound is exhausted, `LIST_SCAN_LIMIT` reports unknown
remaining coverage without promising unsupported continuation.

```typescript
import { openRecoveryRoot } from "@local/object-mcp/recovery";

const opened = await openRecoveryRoot("/explicit/existing/vault");
if (opened.status === "opened") {
  try {
    const page = await opened.root.readRange({ path: "notes/broken.md" });
    if (page.status !== "failed") {
      const bytes = Buffer.from(page.bytesBase64, "base64");
      console.log(bytes.length, page.nextOffset, page.eof, page.issues);
    }
  } finally {
    await opened.root.close();
  }
}
```

Opening returns version `1` with `status: "opened"` and the owned root, or a
`failed` result with safe issues. Read/list results use version `1` and
`ok | partial | failed`. Successful/partial pages include confinement assurance
and before/after stat provenance. Read pages always state `snapshot: false`,
scope their SHA-256 hash to returned bytes, and qualify EOF as
`observed-end | not-reached | unknown`. A caller-supplied revision token detects
observed changes; it is not a whole-file content checksum.

`observed-end` requires an actual zero-byte read without issues; reaching the
stat-reported size is insufficient. Some regular virtual files report size zero
while yielding more bytes. A full page reports `not-reached` even if it ends
exactly at an ordinary file's reported size; request the next page to observe
the end. Read faults, revision differences and a zero read before the observed
size retain conservative `unknown` EOF and diagnostics.

Listings are per-directory, nonrecursive and in filesystem-unspecified order.
Pagination replays offsets, not a stable snapshot cursor. Non-UTF-8 native names
are exposed as exact base64 name bytes with an unsupported-encoding diagnostic;
the current string-path API cannot address them. Linux/procfs uses descriptor
anchoring; `portable-checked` mode cannot eliminate hostile concurrent ancestor
replacement races. Cancellation is cooperative between filesystem calls, not a
hard syscall timeout. `close()` rejects new work, drains active calls and closes
the owned root handle; an OS close failure can reject its promise.

Already recovered bytes remain useful after a later read error. Changed
revisions and incomplete reads must be visible; independently read pages are not
an atomic snapshot against arbitrary external editors. Listings expose observed
entries, including duplicate/noncanonical names and unknown directories, without
following unsafe links or pretending an observed count is an exhaustive total.

## Everyday Reads And Safe Fallbacks

Readable content/subsets should be returned with separate interpretation,
identity-assurance and discovery-coverage diagnostics. Missing or broken metadata
does not justify inventing dates, relations or other required fields. Recovered
JSON is a projection, not a lossless replacement for source text.

A typed selector must not silently choose between duplicates. Incomplete
discovery cannot prove absence, uniqueness or a complete total. Return observed
candidates and uncertainty, and retain exact-path source access. Optional
configuration/registry/index/provider failures should disable only the affected
capability when a trustworthy source root is available.

### Listing Result Contract

The Stage 2 listing implementation returns an `ObjectListResult` union. A
complete concrete framework listing includes `complete: true`, numeric `total`,
`observedCount`, `issues`, and `continuation`. Legacy/custom facades may still
return `{objects, total}` for a complete listing.

An incomplete listing includes `complete: false`, `total: null`, required
`observedCount`, `issues`, and `continuation`, alongside its readable unique
`objects`. `observedCount` counts the observed unique readable documents before
pagination, not every scanned file. Duplicate identity groups remain excluded
and reported rather than arbitrarily selected. Semantically partial but fully
read documents do not by themselves imply missing byte/discovery coverage;
unreadable sources and incomplete directory discovery do.

`continuation` is `{offset}` while more observed entries remain, otherwise
`null`. For an incomplete listing, null means only the end of the currently
observed set, not exhaustive discovery or proof that another object is absent.
Offset pagination rescans the source and is not a stable snapshot. Reduced MCP
listings (`includeBody: false`) omit both `body` and partial-source `raw` content.
The listing contract accompanies source-first get/bootstrap and optional
capability fallbacks below. Strict typed mutation guards remain unchanged.

### Read-Only Source Initialization

The registry-aware `FileStore` now accepts a third argument
`{access: "read-only"}`. It opens an existing root without creating that root,
registered type directories or SQLite coordination storage. A missing registered
directory is reported as a discovery issue, not created to make a read succeed.
Its ordinary Markdown interpretation still uses the registry and YAML; this is
not the dependency-free disaster reader.

Read-only stores refuse source mutations and `withProcessLock` with `READ_ONLY`.
Their exposed `ConfinedFilesystem` also refuses creating directory checks,
staging, publication, writing, renaming and deletion. Non-creating directory
checks, raw reads, hashing and discovery remain available. Mode is immutable for
the instance; reads do not silently upgrade it to a writer.

Default store construction retains write-mode initialization and cooperative
SQLite source coordination. That runtime coordination import is deferred until
writer initialization. This does not remove the lock requirement from writers,
make Effect/YAML optional, or yet alter framework/normal-server startup.

### Source-First Composition

The new internal entry `src/lib/source-access/index.ts` provides
`createSourceAccess({config, definitions, factory?})`. Its source contracts,
normal serve/library integration and the corrected Stage 2 gate passed their
recorded scoped checks and review.
Its resolved config and registered definitions
must be trustworthy. The independent reader remains the route when those inputs
cannot be interpreted safely.

Source get/list use the read-only store regardless of the optional factory's
state. A readable known target under incomplete discovery carries
`assurance: {complete: false, identity: "unverified", issues}`; absent targets
under unknown coverage return `SCAN`, not `NOT_FOUND`. An observed duplicate
returns `DUPLICATE_ID` with candidate relative paths instead of selecting a copy.
Neither result proves uniqueness against unobserved files.

Optional capabilities report `idle`, `starting`, `ready`, `failed` or `closed`.
Hosts may explicitly await `whenReady()`; ordinary source get/list do not await
that startup. Typed mutations, relations and resync require a ready
delegate or return `CAPABILITY_UNAVAILABLE`. Search has the source fallback
described below; normal `serve` uses this composition. Source status
and optional-capability readiness remain distinct claims. Cancellation is
cooperative; closing cannot forcibly interrupt a non-cooperative factory or OS
operation.

The optional factory transfers a resource-owning facade. That delegate's
`close()` must cancel and drain its admitted operations before disposing its
resources. The source wrapper owns source reads and factory startup/cleanup; it
does not add a second lifetime tracker around delegated operations. The existing
ObjectFramework has such an operation-draining close contract. Custom factories
must provide the same guarantee; returning an arbitrary facade with an immediate
close does not provide it.

The framework now implements an explicit `reconciliation: "projection"` option
in its creation options; its scoped lifecycle/safety review passed. It refreshes
metadata/full-text state without source filename alignment or embedding jobs.
The default remains `"maintenance"`, including its existing rename/embedding
behavior. This policy applies to scheduler passes and explicit `resync()` on
that instance; it is not a read-only database inspection mode. Projection can
write ordinary derived state under writer coordination.

Projection currently refuses missing-row deletion whenever the scan has any
issue, including semantic partial warnings, although those readable partials
are still upserted/indexed. This is conservative: stale cached rows can remain
until a clean pass; callers must not treat them as proof of a current source.
Search still revalidates source checksums. Confirmed duplicate keys can be
invalidated without claiming complete discovery.

A successfully installed watcher now remains usable after a failed first
reconciliation. The original startup promise retains its rejection; later
explicit, event or periodic reconciliation can recover. Failed watcher
installation still stops/cleans the lifecycle. This does not automatically retry
every failed capability or turn maintenance resync into a harmless read retry.

The internal `createResilientRuntime({config, definitions, factory?})` in
`src/lib/resilient-runtime.ts` composes that source access with a supervised
optional framework. It captures owned config and definition/descriptor snapshots
before awaiting source initialization, so later caller mutations cannot make
reads and writes select different roots or registrations. It does not freeze
the caller's objects or clone trusted schema implementations.

Its default factory dynamically imports the framework, selects projection
reconciliation and deferred startup, and never calls model preparation. An
owned projection-config copy sets the optional index's native SQLite busy
timeout to zero, so schema initialization fails fast on contention rather than
waiting in a synchronous busy handler on the source-serving event loop. Caller
source config, ordinary framework and explicit diagnostic-command timeouts stay
unchanged. This is not a guarantee that every driver-open/native/filesystem call
is interruptible or nonblocking, and construction/schema setup is not retried.
An
initial reconciliation failure is nonfatal to the initialized optional facade;
later resync can recover. Optional framework construction can still create its
normal derived storage and writer coordination. This is application bootstrap,
not the side-effect-free recovery reader or a doctor probe. Source-root opening
itself remains noncreating.

Shutdown aborts supervised startup and closes any acquired framework, including
one acquired during cancellation. The resource-owning delegate contract above
still applies; noncooperative factories or OS operations can delay draining.
Normal `serve` uses this composition without awaiting optional startup or
preparing embeddings. Explicit `sync`/`status` retain their maintenance/startup
semantics, with watching disabled; only explicit `sync` prepares embeddings.
Serve requires an existing source root. Broken config/registry/MCP loading still
uses the independent recovery CLI rather than a guessed root.

A search fallback reports the mode actually used. The current implementation
returns `{mode: "source", requestedMode, hits, indexGeneration: null, complete,
observedCount, issues, recovery: {state: "degraded", code}}` when optional startup
is unavailable, a known index-readiness gap exists or derived search fails.
Successful indexed responses retain their numeric generation and existing mode.
The request still accepts only `fulltext`, `semantic` or `hybrid`; `source` is an
honest response mode, not a new request mode.

Source matching requires every distinct Unicode letter/number/mark query token,
with case and diacritic folding. It caps distinct tokens at 128, deduplicates
selected registered types and scans those types sequentially. Its simple
frequency score and stable identity/path ties are not SQLite BM25 or semantic
ranking. Source hits have null lexical/semantic ranks, native excerpt and matched
chunk; `body` appears only when requested, and no dedicated `raw` field is
returned. Partial hits preserve recovered metadata, identity provenance and
issues. Observed counts precede query matching/top-N, not an exhaustive total
when coverage is incomplete.

Known syncing, dirty or absent-initial-sync status selects `INDEX_NOT_READY`;
positive pending embedding work also selects `SEMANTIC_INDEX_NOT_READY` for
semantic/hybrid requests. Unknown custom-facade status does not itself prove
unreadiness. Invalid requests and cancellation remain failures, not recovered
searches. The fallback does not prepare a model, resync or repair persistent
state. Focused search/MCP tests and independent scoped review pass; they are not
a claim of complete semantic ranking or a final full-project gate.

Lexical/source fallback is not a successful semantic search under a different
label.

The narrow source retry policy covers document-file open and positional-read
calls that throw raw `Error` instances with exact `EAGAIN` or `EBUSY` codes,
before scanning converts those failures into issues. It excludes directory
traversal/enumeration, metadata reads, parsing, framework/domain errors,
permanent or unknown errors, successful scans with issues, optional factory
initialization, typed mutations, reconciliation and index/model work.

Each source get/list or source-fallback search establishes an isolated async
scope with one additional file-operation attempt shared across its scan, a
100 ms admission deadline measured from request entry and a 10 ms abortable
backoff. A retried operation has at most two attempts; another file cannot reset
the allowance or deadline. The budget prevents admitting another attempt; it
does not forcibly stop an active filesystem promise. The helper preserves the
first transient error when that operation exhausts; normal scan/get conversion
may subsequently expose it as a safe issue or incomplete-coverage failure.

After a retry report, `status().sourceRecovery` shows the latest `retrying`,
`recovered`, `exhausted` or `aborted` outcome, with a stable code and attempt count.
It contains no private source/config values and is not a global health or
complete-index claim. Caller/lifecycle cancellation owns the delay and operation;
timers/listeners are cleaned and close drains admitted work. An initial
outer-operation placement missed file-read errors; it has been replaced by
read-boundary admission. Parent tests inject faults at an opened file handle,
then delegate to actual file reading. Sol reviewed the corrected boundary and
closed the Stage 2 retry blocker. Direct injected file-open failure remains a
coverage gap; the actual open-branch placement is statically reviewed. Explicit maintenance
operations must not be reused blindly as harmless retries or expanded into
source rename, migration, model preparation or permission changes.

## Doctor

### Core Delivery Status

The diagnosis core is implemented in `src/lib/doctor/` and has passed its focused
tests. Built-in semantic/configuration/cache/publication checks and CLI/MCP
adapters are implemented and pass their initial focused integration selection.
The Stage 3 safety review found optional-load isolation, bounded output inspection,
inter-page revision and native-filename coverage gaps. The retained review closed
three and specified two narrow remaining cases. Parent inspection and focused
regressions now establish those remaining nested-entry and non-regular-source
criteria. Stage 3 is accepted within its declared scope and the final configured
validation described above. Diagnosis never certifies that a proposed repair has
been applied or that an unchecked capability is healthy.

`runDoctorReport({root, probes?, builtinProbes?, signal?, budgetMs?, limits?})`
returns a version-1 report with `status`, `requestedProbes`, `probes` and
`findings`. Its default selection is `root` and `inventory`: opening the existing
root and counting observed entries, not reading source contents or proving
semantic validity. Each probe reports `ok`, `findings`, `blocked`, `failed` or
`not-checked`, with coverage and numeric context. A requested check without an
implementation is blocked, not silently skipped. Unselected checks are
`not-checked`.

Inventory defaults and hard maxima are 1,000 entries, 100 directories and a
30-second cooperative budget; callers may lower them. A reached bound makes
coverage limited. Symlinks are reported but not followed. The deadline controls
admission/cancellation of cooperative work, not interruption of a blocked kernel
call. Metadata inventory is not proof that every source can be read or that a
cache is current.

Inventory carries each directory page's continuation revision into the next
request. An observed inter-page change limits coverage; this does not make the
whole tree an atomic snapshot.

The core's `builtinProbes` seam is only for trusted compile-time implementations,
not runtime plugin loading. Supplying implementations currently adds their IDs
to the requested set; adapters must supply only those selected by the caller.
Built-in check producers must emit fixed safe diagnostic fields themselves:
post-format path filtering cannot guarantee removal of private values from
arbitrary prose.

### Implemented Diagnosis Entry Points

```bash
# Normal CLI: requires an explicit existing source root, defaults to root/inventory.
bun src/cli.ts doctor --root /workspace/project/vault

# Minimal entry: only root/inventory; no optional parsing/database/MCP libraries.
bun src/recovery-cli.ts doctor --root /workspace/project/vault

# Additional fixed checks are opt-in on the normal CLI.
bun src/cli.ts doctor --root /workspace/project/vault \
  --checks root,source-validation,cache \
  --cache /workspace/project/cache.sqlite --budget-ms 1000
```

The normal CLI accepts `--checks` with known probe names, `--config` for an
explicit file to inspect, `--cache`, `--out` for materialized output checking and
`--budget-ms`. These paths are resolved from the working project directory;
config/cache files must be confined to that project. Selecting a check without
its required path produces a blocked, incomplete report, not an inferred path.
The normal CLI routes diagnosis before loading normal configuration or creating
the application framework. Its executable can still depend on normal CLI
imports; the separately built recovery entry is the optional-dependency safety
net.

The default server adds `objects_doctor` (68 tools in total). Library server
registration is explicit via `registerDoctorTools`; the generic facade's tool
surface is unchanged. The MCP input permits `checks`, `budgetMs`, `maxEntries`
and `maxDirectories` only. Paths are selected and snapshotted by the host at
registration, not supplied by tool arguments. MCP returns the versioned report,
not a shell exit code; execution errors are error results rather than fabricated
successful reports. Neither entry accepts a universal repair/fix operation.

Configuration checking currently certifies syntax only and reports its semantic
coverage as limited. Cache inspection reads a bounded header only and always
leaves integrity/freshness unchecked. Source validation uses the fixed built-in
core definitions, without loading a caller plugin; semantic errors preserve
error severity, while unobserved files or partial inputs qualify coverage.
Materialization invokes check mode without evaluating generated modules and
conservatively reports limited coverage even when no drift is found. Consequently
these deliberately limited checks can yield exit `3`; that is not a healthy-cache
or runtime-readiness certificate. Fully observed source validation errors such as
duplicate identities yield error findings and exit `2` when no requested check
is incomplete.

Fixed optional implementations load independently when selected. A missing
optional module blocks its probe without discarding root/inventory results or
other available checks. A failure to load the optional-probe builder likewise
produces blocked selected probes rather than destroying the core report.

Doctor's materialized-output inspection admits at most 1,000 entries, 1 MiB per
file and 8 MiB total. It streams output enumeration and bounded read chunks,
checks cancellation between operations, and refuses unowned outputs before
reading their content. Exhaustion blocks the check; it never publishes output.
Normal materialization callers without these check-mode limits retain their
existing contract. Unsupported native source filenames are detected before
constructing descendant paths and qualify source coverage rather than aliasing
another Unicode filename. Filesystem calls and trusted module loading are still
not forcibly interruptible by a cooperative deadline.

### Diagnosis Contract

Doctor diagnosis is read-only by default and never a prerequisite for reading.
Requested probes run independently with bounded budgets. One failed or blocked
probe must not destroy useful results from the others. Unselected checks are
different from requested checks that could not run.

Reports are versioned and identify probe/capability state, coverage, stable
finding codes, severity, safe relative locations and proposed actions. They must
not contain source/config values, credentials, raw exceptions or absolute home
paths. Authorized content delivery belongs in source-read operations, not support
diagnostics. Provider identity is not proof of inference readiness.

Diagnosis must not initialize a framework/database, change journal/schema state,
create roots/caches, reconcile, rename sources, prepare/download models, run
inference or execute arbitrary plugins. If a database cannot be inspected
genuinely without mutation, report that check unavailable rather than using its
normal mutating constructor.

The doctor exit precedence is:

| Exit | Meaning |
| --- | --- |
| `1` | Usage/bootstrap/internal failure prevented a usable report |
| `3` | A usable report exists, but at least one requested probe is incomplete |
| `2` | Requested probes completed and blocking findings remain |
| `0` | Requested probes completed without blocking findings |

When findings and incomplete probes coexist, `3` takes precedence over `2`;
findings remain in the report. Intentionally unselected probes do not force an
incomplete exit. MCP exposes equivalent structured outcomes rather than treating
every degraded result as a total tool failure.

## Explicit Source Repair

### Implementation And Validation Status

The library core, CLI and MCP adapters are implemented. Focused parent checks
cover approval capture, backup/revision guards, cancellation and cleanup. The
planned protected review identified coordinator hardlink aliases and cache path
resolution after asynchronous maintenance admission; parent regressions verified
their bounded corrections against the stated criteria, not a fabricated new
reviewer PASS. A later Sol review approved the library-definition injection fix;
the unchanged library-boundary test and final tests pass. These contracts are not
instructions to repair the live project.

`createSourceRepairSession({root, driver?, confinement?, maxBytes?, lockTimeoutMs?})`
opens an existing root without creating registered directories or coordination
storage merely to plan. Its methods are `planReplacement`, `planPatch`,
`planDraft`, `planSalvage`, `apply`, `rollbackReplace` and `close`. Full-source
planning and writes are bounded to at most 5,000,000 bytes; this is distinct from
the paged disaster reader, which can inspect larger files without pretending a
page hash authorizes a whole-file overwrite.

Plans carry version, action ID, operation, relative source/destination paths,
before/after whole-byte checksums, size and canonical base64 payload. Action IDs
bind the mutation fields, including salvage destination; they are integrity and
idempotence identifiers, not authentication signatures or proof of operator
approval. Apply/rollback require a separate `{approved: true, signal?}` argument.
Approval, cancellation-signal reference and a validated owned plan projection
are captured at call entry before asynchronous admission. Later caller mutation
cannot turn a denied call into an approved write or redirect its destination.

Replacement/patch backup files are derived as
`.object-mcp-recovery/backups/<actionId>.bak`; rollback also preserves the
post-repair bytes in `<actionId>.rollback.bak`. An existing backup must contain
the expected bytes; it is never adopted or overwritten merely because its path
exists. Draft/salvage destinations are exclusive creations with unverified
object-identity assurance. Salvage preserves the original source. Rollback is
replacement-only and refuses later source changes; it does not delete drafts or
salvage copies.

Approved application lazily loads the ordinary SQLite source coordinator and
uses the same root coordination file as normal writers. Planning does not load
that coordinator. Observed symlink/nonregular/multiply linked coordinator and
journal/WAL/shared-memory targets are refused before native opening. The exact recovery namespace
cannot be used as a source or draft/salvage destination. These preflight checks
do not eliminate arbitrary concurrent filesystem replacement races. A result
reports `sourceCommitted: true` and
`indexState: "not-updated"`, with `committed` or revision-proven
`already-applied` state. No implicit source rename, YAML reconstruction,
reconciliation or embedding operation follows a repair. Cancellation is
cooperative and close drains actual admitted work; native coordinator opening
is not advertised as forcibly interruptible.

### CLI And MCP Operations

The separate Bun entry is `src/repair-cli.ts`; `bun run repair` invokes it, and
the normal CLI routes `repair` before framework/configuration startup. Commands
`plan`, `apply` and `rollback` require an explicit `--root`; `--driver` optionally
selects `bun` or `better-sqlite3`. Apply/rollback additionally require `--approve`.
Planning rejects that flag rather than treating it as implicit write consent.

Each command consumes one bounded UTF-8 JSON request from stdin (at most 8 MiB)
and emits one JSON response after cleanup. Plan requests select `replace` or
`draft` with `sourcePath` and `payloadBase64`, `patch` with byte-coordinate edits
`{offset, deleteBytes, insertBase64}`, or `salvage` with source/destination paths.
Replacement/patch may supply `expectedChecksum`. Apply/rollback consume the inert
returned plan, not a newly inferred mutation. Successful commands exit `0`, usage
or invalid request/plan failures `1`, and blocked/cancelled/cleanup failures `2`.
A cleanup failure retains a known committed result when available; a nonzero exit
must not be interpreted as proof that no write occurred.

The default application server registers `objects_repair_plan`,
`objects_repair_apply` and `objects_repair_rollback`. Roots and driver/confinement/
lock/file limits are captured from trusted host configuration; callers cannot
override them. Apply/rollback require `approved: true` separately from the plan.
Request cancellation closes/drains the owned session; it does not promise forced
kernel-call interruption. Reduced generic library MCP servers do not acquire
these tools unless explicitly registered.

Normal typed creation/update retains its validation guarantees. Explicit
path-addressed repair/draft operations may leave metadata partial, with identity
assurance stated honestly. Unrelated defects need not prevent a local edit when
its target and current full revision are established safely.

Source changes require a selected target, preview, expected whole-source
revision, explicit approval, coordinated publication and byte-exact backup or
salvage. Backup failure blocks overwrite. Preserve untouched bytes/unknown
fields/comments where the selected edit permits it. Never regenerate a damaged
source from recovered JSON. Unsafe structured edits should offer exact
patch/replacement rather than guess what malformed YAML means.

The live SQLite coordination file is not a disposable index. Do not bypass or
delete it while ordinary writers can run. If shared coordination is unavailable,
require an approved exclusive/offline condition or write a salvage copy instead.
Checksums alone are not atomic filesystem compare-and-swap against arbitrary
noncooperating editors. Repeated apply/rollback checks current revisions and
returns already-satisfied/conflict instead of overwriting later work.

## Automatic Recovery Boundaries

| Tier | Allowed action | Admission rule |
| --- | --- | --- |
| A, initial default | Nonpersistent raw/partial/byte or available lexical/source fallback; bounded transient retries | No persistent repair, guessed root/identity, hidden truncation, lossy decoding, source rename or model work |
| B, explicit opt-in | Background rebuild of a known dedicated metadata/lexical index cache into a separate candidate, post-check and guarded publication | Proven target ownership/format, safe paths, complete intended source discovery/read coverage and cooperating-writer/exclusive-maintenance boundary |
| C, never automatic here | Source identity resolution/rewrite/delete/rename, field/relation removal, config reset, permission changes, installs/downloads, plugin execution or adoption of edited output | Return findings and require a separately explicit operation |

Tier B is disabled until the operator pre-authorizes its known dedicated target
and policy. It never covers the live coordination database, authoritative
sources, model assets or edited/unowned generated modules. Unknown ownership,
paths, coordination or coverage selects the non-mutating fallback. Every
unreadable intended source makes coverage unknown; a directory walk's `complete`
flag alone is insufficient. Semantically partial but fully read documents are a
different condition from unreadable files.

### Initial Offline Publication Policy

The owner approved implementing an offline metadata/text-only rebuild of the
built-in combined cache. That approval permits the implementation contract, not
an immediate rebuild of any actual project cache. The old cache must be retained;
published candidates contain no computed embeddings, so cached semantic search
stays unavailable until embeddings are explicitly rebuilt. Loading the installed
vector extension to create the current cache schema is not model inference.

The supported maintenance boundary is a trusted, nonserialized host callback.
It must fence new cache owners, stop admissions, drain and close all relevant
connections/startup/watchers/reconciliation/embedding work, and exclude other
cooperating processes. It holds that boundary through inspection, candidate
construction, publication and any guarded rollback. Fresh owners may open only
after a settled outcome; an unresolved crash receipt must keep startup fenced.
This is a deployment precondition, not global quiescence detected by the library.
A tool argument such as `offline: true`, the ordinary source lock, or closing one
tracked facade does not establish it.

Normal runtime and MCP cache publication remain blocked without this capability.
The first library implementation supports an existing, dedicated, safely located
current-format cache only. Missing targets, unknown ownership/format, aliases,
unsafe paths and residual WAL/journal/shared-memory state select a blocked
outcome rather than speculative repair. A future broader format or runtime
owner-rotation protocol requires separate design; it is not inferred here.

Native candidate construction runs in an owned Bun child with finite work and
deadline/cancellation supervision, not synchronous SQLite on the source-serving
event loop. Post-checks must establish a closed self-contained current-format
image, exact source-manifest/metadata agreement, usable FTS and zero embeddings.
A durable verified old-cache copy precedes one same-filesystem atomic target
replacement. Do not rename the old target away first. Guard rollback by the
published candidate revision while maintenance still holds; changed/reopened
targets must not be overwritten. Preserve failed candidates and old state.
Ambiguous crash state is blocked, not silently retried or advertised healthy.

Persistent attempt receipts, target-wide coalescing/cooldown and finite action
budgets prevent restarts or fresh request IDs from creating unbounded rebuild
loops. The host-selected worker entry and maintenance callback are trusted code,
not caller-selected executable imports or serialized capabilities. Focused
synthetic tests exercise successful offline jobs and negative admission/rollback
paths, but no actual project target has been enabled or rebuilt. Stage 4 acceptance
uses those phase-review criteria, parent regressions and final project validation;
it does not certify an arbitrary deployment's maintenance callback.

### Offline Library API

`@local/object-mcp/cache-recovery` exports `createCacheRecoveryController`.
Construction takes `enabled`, `allowSemanticReset`, `authorizedDirectory`,
`relativeTarget`, `sourceRoot`, `workerEntrypoint`, `sqlite`, `search`, and the
trusted `withExclusiveCacheMaintenance` callback. `recover({signal?})` requests
the fixed policy operation; `close()` aborts and drains owned work. Missing policy,
semantic-reset consent or maintenance capability returns a blocked outcome before
starting a job. There is no default automatic application/MCP activation.

Host-selected paths, including SQLite and optional native-library paths, resolve
once against the controller's construction-time working directory. Coalescing,
maintenance admission and later publication use that owned absolute snapshot;
caller mutations or a later CWD change cannot redirect the job. `relativeTarget`
stays relative and confined. The initial worker supports the built-in source
profile, not arbitrary executable plugins or serialized schema codecs.

Budgets default to 60 seconds, at most 64 MiB per cache image and 32 retained
receipts; the total deadline can be configured up to 120 seconds. Source admission
is separately bounded to 1,000 files, 100 directories, 10,000 entries, 32 MiB total
source bytes, 5,000,000 bytes per source and depth 32. Exhausted/ambiguous coverage
blocks publication rather than silently dropping files. There is no automatic
receipt/backup pruning to evade those limits.

Successful `recovered` / `already-satisfied` outcomes carry the action ID and
observed counts, `semantic: "unavailable"`, and
`assurance: "observed-source-rechecked-metadata-only"`. Other outcomes distinguish
`blocked`, `failed` and `cancelled` with fixed codes. Receipt/work-area or rollback
ambiguity requires manual inspection with startup still fenced; it is not a cue
to blindly retry or reopen writers. An unresolved host-maintenance callback cannot
be forcibly interrupted by this library. No atomic-source-snapshot or protection
against arbitrary noncooperating editors is promised.

Reads never wait for repair. Doctor diagnosis and independent reads never start
persistent jobs. Automatic jobs have a finite allowlist, one in-flight operation
per target/revision, bounded attempts/time/resources, cancellation, cooldown and
idempotent action IDs. Preserve the old usable cache until a replacement passes
post-checks; retain/quarantine corrupt state rather than repeatedly deleting or
rebuilding it. Report actual source/revision assurance and original failure
separately from attempted/recovered/degraded/blocked/failed recovery outcomes.

## Unchanged Boundaries

The containing storage directory remains the access boundary for a colocated
derived cache. This work does not add cache-only chmod/chown/private isolation.
Automatic body-wikilink-to-frontmatter additions and automatic reference pruning
remain canceled. Wrong graph results, incorrect indexes, unsafe staging and
private diagnostic disclosure are not errors to suppress in the name of access.
