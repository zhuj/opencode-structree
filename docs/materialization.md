# Typed Vault Materialization

Markdown remains authoritative. Materialization creates a disposable TypeScript read model, not application implementations inferred from prose. The generated graph makes registered relations and explicit code bindings available to TypeScript tooling and handwritten Bun policies.

## Package Boundaries

- `@local/object-mcp/model`: pure reference, provenance, file-binding and graph types plus `createObjectGraph` and `referenceKey`. Built JavaScript and declarations live in `dist/model/index.js` and `dist/model/index.d.ts`. Importing it starts no filesystem, MCP, database, watcher or embedding work.
- `@local/object-mcp/materialization`: source-backed `validateObjects` and `materializeObjects`. Uses the supplied `ObjectDefinition[]`, including custom plugin schemas and relation descriptors.
- `@local/object-mcp/materialization-mcp`: optional `registerMaterializationTools(server, options)`. The host fixes the source roots and output destination.

Existing package source exports are unchanged. `bun run build` builds the CLI and model library; `bun run build:model` builds only the model. Bun emits JavaScript; TypeScript emits the matching declarations.

## CLI

```bash
bun run build
bun run validate
bun run materialize --check
bun run materialize
bun run materialize:check
```

Commands accept `--config <file>`. Materialize also accepts `--out <directory>` and `--check`, in either order. The default output is `.local/.structree/materialized` relative to the working project directory. Existing configuration layering still selects the vault root.

The direct CLI forms below are part of the host integration contract; the isolated example does not verify CLI or MCP wiring. Omitting `--config` uses built-in defaults plus the optional project-local override, and `--out` is optional:

```bash
bun src/cli.ts validate --config object-mcp.config.json
bun src/cli.ts materialize --check --out generated/objects --config object-mcp.config.json
```

Validation and materialization return before framework initialization. They do not prepare models, initialize caches, run reconciliation, rename Markdown or execute generated code. Exit status is `0` for valid/clean results, `2` for validation errors or drift, and `1` for usage or unexpected runtime errors. JSON includes counts and structured diagnostics, as well as complete objects and explicitly partial documents.

`--check` performs no writes, including when the output directory does not exist. Missing output is drift, not a request to generate it.

## Library API

```typescript
import { materializeObjects, validateObjects } from "@local/object-mcp/materialization";

const options = {
  definitions, // The plugin's registered ObjectDefinition[]
  projectRoot: "/workspace/project",
  vaultRoot: "/workspace/project/.local/.structree/objects",
};
const validation = await validateObjects(options);
const result = await materializeObjects({
  ...options,
  outputDirectory: "/workspace/project/.local/.structree/materialized",
  check: false,
});
```

Both APIs accept an optional `signal`. Materialization also accepts `modelImport`, defaulting to `@local/object-mcp/model`. This module must be resolvable from the generated project for compilation and execution. Tests can select an absolute source-module path; an installed consumer normally uses the package export.

Both results include `valid`, `diagnostics`, `counts`, `objects` and `partialObjects`. Materialization adds `clean`, `published`, `manifest` and `drift`:

- `valid` means no validation/publication errors were reported. In check mode it can be true while outputs are missing or changed.
- `clean` means valid with no drift in check mode, or successful publication in write mode.
- `published` distinguishes a write-mode publication from a non-writing check.
- `drift` describes missing, changed and obsolete outputs observed before publication, so a successful publication can have `clean: true` and a nonempty `drift` list.

## Three Distinct Link Contracts

Source provenance is `{ root: "vault", path, checksum }`. Paths are vault-relative; checksums identify the Markdown revision. Stable object identity is the pair `(type, id)`, never the ID alone.

Semantic references are `{ field, kind, target: { type, id } }`. Registered relation descriptors determine their meaning, target type and cardinality. Descriptor paths address decoded plugin values even when a schema codec uses another wire representation. Generated headers retain encoded JSON, including string timestamps, rather than falsely claiming to be decoded domain objects with `Date` values.

Implementation, test and documentation links require an explicit convention:

```yaml
metadata:
  fileBindings:
    - root: project
      path: src/orders.ts
      role: implementation
      symbol: createOrder
    - root: project
      path: test/orders.test.ts
      role: test
```

Supported roles are `implementation`, `test` and `documentation`. `symbol` is optional descriptive text, not a verified symbol lookup. Paths must be portable project-relative paths to existing regular files without symlink components. Bindings are checked again before publication. Arbitrary metadata strings are never interpreted as file links.

## Generated Artifacts

- `catalog.ts`: exact type/ID pairs and the discriminated `CatalogRef` union.
- `objects/<stable-hash>.ts`: one data-only module per object. Original IDs are preserved as values; punctuation never becomes an unsafe filename or identifier. Each record exposes `source.path`, `references` and `fileBindings`.
- `graph.ts`: the object collection and a resolver with outgoing/incoming references. References remain data, so resolving them does not require eager inter-object imports.
- `manifest.json`: format and generator versions, schema/descriptor fingerprint, source checksums, owned outputs and output hashes. It contains no fresh generation timestamp.

Generated literals are escaped, including adversarial keys such as `__proto__`. Concrete headers get literal inferred types; references must satisfy the catalog's exact type/ID pairs. This deliberately does not pretend to translate every arbitrary Effect transform/refinement into a generated domain interface.

`source.path` is an ordinary editor-recognizable path string such as `criteria/criterion-login.md`. Resolve it relative to `vaultRoot` when presenting a clickable source location; do not treat the hashed generated filename as the original source path.

The validator checks schema decoding, duplicate identities, declared relation cardinality, missing/mistyped/ambiguous targets, directed impact/containment cycles, and file bindings. It imposes no extra global single-owner rule on custom plugins. Partial sources retain recovered data and explicit identity provenance, without fabricated required fields; strict materialization refuses them with diagnostics. Source enumeration is exhaustive, not capped search.

## Ownership, Publication And Recovery

Output must be a dedicated directory inside the project, disjoint from the vault and bound source files. Unowned files, edited generated files, symlinks and noncanonical manifests are conflicts, not candidates for overwrite. Obsolete outputs are reported and retained; nothing is automatically deleted.

The full output is staged under project-local `.tmp/`, then vault revisions, output ownership and bindings are checked before commit. Publication is atomic **per file**, with the manifest committed last, not an atomic whole-directory transaction. Cancellation is honored before commit; it does not interrupt between file commits.

An I/O failure or process termination during commit can leave files inconsistent with the old manifest. The next run conservatively refuses those files as edited. Preserve that generated directory for inspection, move it outside the configured output directory, then regenerate into a fresh output directory and recheck. Use the same inspect/archive/regenerate approach for obsolete outputs. Do not edit the manifest to claim handwritten or unverified files.

Precommit checks narrow race windows; they do not provide an operating-system sandbox or lock out concurrent external editors. Run generation against a stable checkout when reproducible CI evidence is required.

## Bun Policies And Type Checks

To run the isolated example directly with the default built `@local/object-mcp/model` import:

```bash
export TMPDIR="$PWD/.tmp"
bun run build:model
bun examples/materialization/run.ts
```

The runner writes only a synthetic project created with `tmpdir()` and `mkdtemp()`, never the real project vault. It removes its scratch directory in `finally`, including on failure. Its phases are materialization, generated-scope TypeScript checking, negative target type/ID checks, then the three handwritten Bun policies. The installed compiler is resolved by absolute path. No giant generated files are checked in.

```bash
bun run example:materialization
bun test examples/materialization/policies.test.ts test/materialization-generated.test.ts
```

The example uses a temporary synthetic vault and cleans it up. It checks generated output against the built model and runs three independently handwritten policies: active criteria have acceptance-test references, active interfaces have implementation bindings, and active dependencies do not target retired objects. The Bun tests also demonstrate each policy rejecting a broken graph. Generated-code tests invoke the installed TypeScript CLI, accepting the valid graph and rejecting invalid target IDs and type/ID pairs without type-error suppressions.

The policies explicitly include active `depends` and `justifies` edges. Their assertions are external handwritten code, not generated from relation descriptors. Each of these structurally valid negative fixtures must exit nonzero with its corresponding policy failure:

```bash
bun examples/materialization/run.ts uncovered-criterion
bun examples/materialization/run.ts unbound-interface
bun examples/materialization/run.ts retired-target
```

The focused generated-artifact test and the policy test's default fixture use an absolute source-model import, so full-suite execution does not require preexisting `dist`. The runner separately exercises the built package's default import.

For an output directory retained by your own caller of `materializeObjects`, equivalent explicit compile and policy commands are:

```bash
bun ./node_modules/typescript/bin/tsc --ignoreConfig --noEmit --strict --target ES2023 --module ESNext --moduleResolution Bundler --skipLibCheck generated/objects/graph.ts
MATERIALIZATION_POLICY_GRAPH="$PWD/generated/objects/graph.ts" bun test examples/materialization/policies.test.ts
```

These particular policies assume the example's criterion/acceptance-test/interface/service taxonomy; write your own assertions for different plugins.

For a consumer's generated directory, include it explicitly in a dedicated `tsconfig` with `strict`, `noEmit`, and bundler module resolution, then run `tsc -p <config>`. The repository's default `tsconfig` does not include hidden generated directories automatically.

Policy success proves those graph rules, not the actual behavior of an implementation or that a referenced test ran. Keep real implementation tests as separate evidence. MCP never executes generated code.

## MCP And Follow-On Tools

CLI `serve` registers `objects_validate` and `objects_materialize({ check?: boolean })`; library server hosts opt in with `registerMaterializationTools`. Callers cannot override paths, imports or execution options. Invalid results or `clean: false` produce MCP error results. The materialize annotation is write-capable even when a particular call selects non-writing check mode.

Useful next tools over this read model include semantic graph diffs, file-to-intent lookup, impact reports enriched with file/test bindings, traceability coverage reports and derived architecture diagrams. They need not add another source of truth or an arbitrary execution tool. Impact-based test selection should be presented as candidates, not proof of complete test coverage.

Comparable approaches include [Velite's typed content pipeline](https://velite.js.org/), [Projen's source-owned generated files](https://projen.io/docs/introduction/getting-started/) and [Structurizr's model/relationship projections](https://docs.structurizr.com/dsl). Their useful common pattern is a validated authoritative model with disposable derived artifacts, not bidirectional editing of generated files.
