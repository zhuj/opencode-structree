# Reusable Library Boundary

`src/lib` is common, application-independent code. It provides general indexing,
retrieval/RAG, embeddings, object storage, repositories, source access, graph
processing, and MCP infrastructure. It is not the Structree domain layer.

## Dependency Direction

- Application code may import the library. The library must not import or
  re-export application modules, including through erased type imports,
  dynamic imports, package-root aliases, or compatibility shims.
- Keep relative source dependencies inside `src/lib`. External dependencies
  are allowed according to the existing package conventions.
- Accept object schemas, registrations, and relation descriptors through
  generic interfaces. Do not import the application's registry or know its
  built-in object names.
- Do not embed application knowledge in library files to avoid an import.
  Structree-specific schemas, structured object fields, decision statuses, profile
  markers, tool names, and registration policies belong outside this directory.

## Ownership

- Generic object validation, serialization, storage, indexing, search, graph
  algorithms, source safety, and reusable MCP adaptation belong here.
- Structree object types, decision/evidence/review fields, workflow/status rules, and
  application-specific tools belong in the application layer.
- Compose application tools with generic MCP tools in an application adapter.
  Handing application definitions to the library must not cause it to register
  extra domain-specific tools.
- Public library and dependency-free model entry points expose only reusable
  contracts. Export application schemas/types from application entry points,
  not from `/lib` or the generic `/model` bundle.

Note: the `LOCAL_STATE_RELATIVE_DIRECTORY` constant in `config.ts`
(`.local/.structree`) is the single sanctioned exception to the rule above.
It names the framework's default local-state layout, not application domain
knowledge: applications override it through configuration (`root`,
`sqlite.path`, and the local YAML override). No further application
knowledge, schemas, or policies may be embedded on this basis.
- Keep the general-purpose `metadata` map opaque. Do not reserve keys or infer
  structured object fields from its contents. Generic file-binding projection
  reads an explicitly authored top-level field, not legacy metadata values.
- Add shared helpers only when their inputs, outputs, names, and behavior are
  genuinely generic. Do not add a domain-specific callback or flag merely to
  move its implementation elsewhere.

## Change Checks

Before changing this directory, determine whether the responsibility is generic
or application-specific. Put application-specific work outside `src/lib` and
update application composition/callers there.

Use `test/library-boundary.test.ts` and affected object/MCP tests to check both
dependency direction and behavior. Import confinement alone is insufficient:
also check public exports and that a custom registry can use the library without
acquiring Structree schemas, metadata semantics, or tools. Preserve generic
storage/search behavior and validate application integration separately.

Existing project defaults are not permission to introduce new domain coupling
or to broaden a focused task into unrelated cleanup. Follow repository-wide
permission rules for tests, dependencies, configuration, deletion, and commits.
