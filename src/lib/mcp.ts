import { type CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { Schema } from "effect";
import { defaultConfig, McpInputRepairConfigSchema } from "./config.ts";
import { FrameworkError } from "./errors";
import { createMcpInputBoundary, effectMcpSchema } from "./mcp-input.ts";
import { ObjectRegistry } from "./registry";
import {
  LIST_LIMIT_DEFAULT,
  LIST_LIMIT_MAX,
  type McpInputRepairConfig,
  type ObjectFacade,
  RELATIONS_DEPTH_MAX,
  type ReadObject,
} from "./types";

export { effectMcpSchema } from "./mcp-input.ts";

export interface McpToolOptions {
  readonly inputRepair?: Partial<McpInputRepairConfig>;
}

const IdInput = Schema.Struct({
  id: Schema.NonEmptyString.annotate({
    description: "Object identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
  }),
});
// An empty Effect Struct also accepts non-objects; a string-keyed Never record accepts only {}.
const EmptyInput = Schema.Record(Schema.String, Schema.Never);
const NonnegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
/** The relation kinds the tool can follow, in the order the tool lists them. */
const RELATION_KIND_NAMES = [
  "depends",
  "uses",
  "justifies",
  "contains",
  "owns",
  "relates",
] as const;
const DeleteInput = Schema.Struct({
  id: Schema.NonEmptyString.annotate({
    description: "Object identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
  }),
  expectedChecksum: Schema.NonEmptyString.annotate({
    description:
      "Checksum returned by the latest get/list/create/update; prevents overwriting a newer revision.",
  }),
});
/** The bounds a facade advertises; a facade without configuration falls back to the defaults. */
interface EffectiveSearch {
  readonly maxTopN: number;
  readonly defaultTopN: number;
}

/**
 * The advertised bounds must match the effective configuration, so the list and search
 * schemas are built per facade instead of once per module.
 */
function buildInputSchemas(search: EffectiveSearch, typeNames: readonly string[]) {
  // A registry without definitions has no names to publish, so the filter stays a plain string.
  const typeName = typeNames.length > 0 ? Schema.Literals(typeNames) : Schema.String;
  return {
    list: Schema.Struct({
      limit: Schema.optionalKey(
        Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: LIST_LIMIT_MAX })),
      ).annotate({
        description: `Maximum objects to return, 1 to ${LIST_LIMIT_MAX}. Defaults to ${LIST_LIMIT_DEFAULT}.`,
      }),
      offset: Schema.optionalKey(NonnegativeInt).annotate({
        description: "Number of objects to skip in identifier order. Defaults to 0.",
      }),
      includeBody: Schema.optionalKey(Schema.Boolean).annotate({
        description: "Include each object's Markdown body. Defaults to true.",
      }),
    }),
    search: Schema.Struct({
      query: Schema.NonEmptyString.annotate({
        description:
          "Nonblank search text. Fulltext and hybrid's lexical component require all extracted Unicode letter/number/mark tokens (AND), with SQLite case/diacritic folding and no stemming. Punctuation separates tokens; quotes and * do not enable phrase or prefix search. AND, OR and NOT are literal required words, not operators. Lexical evaluation accepts at most 128 distinct extracted tokens before folding; more fails with an INTERNAL error, while punctuation-only text yields no lexical matches. Lexical search covers name, title and raw Markdown, including YAML frontmatter and body.",
      }),
      mode: Schema.optionalKey(Schema.Literals(["fulltext", "semantic", "hybrid"])).annotate({
        description:
          'Defaults to hybrid when the framework has a provider instance, otherwise fulltext. Semantic/hybrid evaluation requires a working provider; the local ONNX provider fetches its pinned model snapshot at startup when the snapshot is missing and downloads are permitted. Use explicit mode: "fulltext" for embedding-free queries or after EMBEDDINGS_DISABLED/EMBEDDINGS_UNAVAILABLE. In hybrid mode a query with no lexical tokens still runs the semantic ranking, and those hits carry no lexical evidence. Valid requests with types: [] return no hits without invoking a provider.',
      }),
      types: Schema.optionalKey(Schema.Array(typeName)).annotate({
        description:
          "Restrict both lexical and semantic candidates to these registered types before ranking limits. Omit for all types; [] searches none. Type and directory names are not added to searchable text. Use the type's list tool to enumerate objects without a content query.",
      }),
      topN: Schema.optionalKey(
        Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: search.maxTopN })),
      ).annotate({
        description: `Maximum number of distinct matching objects, 1 to ${search.maxTopN}. Defaults to ${search.defaultTopN}.`,
      }),
      includeBody: Schema.optionalKey(Schema.Boolean).annotate({
        description: "Include each matched object's complete Markdown body.",
      }),
    }),
    relations: Schema.Struct({
      type: typeName.annotate({
        description:
          "The registered type of the object to start from. Ids are unique within a type, not across types, so the type is always required.",
      }),
      id: Schema.NonEmptyString.annotate({
        description: "The object identifier to start from.",
      }),
      mode: Schema.optionalKey(Schema.Literals(["neighbors", "impact"])).annotate({
        description:
          'Defaults to "neighbors", which returns the relation edges adjacent to the object. "impact" returns the objects a change to the object reaches, and the edges that carry the change.',
      }),
      direction: Schema.optionalKey(Schema.Literals(["incoming", "outgoing", "both"])).annotate({
        description:
          'Which way the walk follows the stored edges, for the neighbors mode only: "outgoing" runs from the source to the target, "incoming" runs from the target to the source, and "both" follows either. An edge is reported with the direction of the walk that first reached it, so one edge keeps one label at every depth. Defaults to "both". The impact mode derives its direction from the relation kind and rejects this argument.',
      }),
      edgeKinds: Schema.optionalKey(Schema.Array(Schema.Literals(RELATION_KIND_NAMES))).annotate({
        description:
          'The relation kinds to follow: "depends" (a holder requires its target), "uses" (a provider is used by its target), "justifies" (a holder is justified by its target), "contains" (a child is part of its target), "owns" (a child is owned by its target) and "relates" (a peer association). Defaults to depends, uses and justifies in the impact mode, and to every kind in the neighbors mode.',
      }),
      depth: Schema.optionalKey(
        Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: RELATIONS_DEPTH_MAX })),
      ).annotate({
        description: `The number of hops to walk, 1 to ${RELATIONS_DEPTH_MAX}. Defaults to 1.`,
      }),
      types: Schema.optionalKey(Schema.Array(typeName)).annotate({
        description:
          "Restrict which related types are reported. The traversal still passes through the excluded types, so a filter narrows the answer without hiding the path that reaches it.",
      }),
      includeRetired: Schema.optionalKey(Schema.Boolean).annotate({
        description:
          "Include retired objects in the reported edges and affected set. Defaults to true; a retired object still links, so excluding it hides real impact.",
      }),
    }),
  };
}
const DocumentIssueSchema = Schema.Struct({ code: Schema.String, message: Schema.String });
const DocumentIdentitySchema = Schema.Struct({
  source: Schema.Literals(["filename", "frontmatter"]),
  id: Schema.String,
  type: Schema.String,
});
const SourceIdentityAssuranceSchema = Schema.Struct({
  complete: Schema.Literal(false),
  identity: Schema.Literal("unverified"),
  issues: Schema.Array(
    Schema.Struct({ path: Schema.String, code: Schema.String, message: Schema.String }),
  ),
});
const PartialReadFields = {
  partial: Schema.Literal(true),
  object: Schema.JsonObject,
  identity: DocumentIdentitySchema,
  issues: Schema.Array(DocumentIssueSchema),
};
const SearchHitFields = {
  type: Schema.String,
  id: Schema.String,
  name: Schema.String,
  title: Schema.String,
  path: Schema.String,
  checksum: Schema.String,
  score: Schema.Number,
  fulltextRank: Schema.NullOr(Schema.Number),
  fulltextExcerpt: Schema.optionalKey(Schema.NullOr(Schema.String)),
  semanticDistance: Schema.NullOr(Schema.Number),
  matchedChunk: Schema.NullOr(
    Schema.Struct({
      index: NonnegativeInt,
      start: NonnegativeInt,
      end: NonnegativeInt,
      text: Schema.String,
    }),
  ),
  body: Schema.optionalKey(Schema.String),
};
const SearchOutput = effectMcpSchema(
  Schema.Union([
    Schema.Struct({
      mode: Schema.Literals(["fulltext", "semantic", "hybrid"]),
      hits: Schema.Array(
        Schema.Union([
          Schema.Struct({
            ...SearchHitFields,
            partial: Schema.optionalKey(Schema.Literal(false)),
            object: Schema.optionalKey(Schema.Never),
            identity: Schema.optionalKey(Schema.Never),
            issues: Schema.optionalKey(Schema.Never),
          }),
          Schema.Struct({ ...SearchHitFields, ...PartialReadFields }),
        ]),
      ),
      indexGeneration: NonnegativeInt,
    }),
    Schema.Struct({
      mode: Schema.Literal("source"),
      requestedMode: Schema.Literals(["fulltext", "semantic", "hybrid"]),
      hits: Schema.Array(
        Schema.Union([
          Schema.Struct({
            ...SearchHitFields,
            partial: Schema.optionalKey(Schema.Literal(false)),
            object: Schema.optionalKey(Schema.Never),
            identity: Schema.optionalKey(Schema.Never),
            issues: Schema.optionalKey(Schema.Never),
          }),
          Schema.Struct({ ...SearchHitFields, ...PartialReadFields }),
        ]),
      ),
      indexGeneration: Schema.Null,
      complete: Schema.Boolean,
      observedCount: NonnegativeInt,
      issues: Schema.Array(
        Schema.Struct({ path: Schema.String, code: Schema.String, message: Schema.String }),
      ),
      recovery: Schema.Struct({
        state: Schema.Literal("degraded"),
        code: Schema.Literals([
          "SOURCE_ONLY",
          "CAPABILITY_STARTING",
          "CAPABILITY_FAILED",
          "DERIVED_SEARCH_FAILED",
          "INDEX_NOT_READY",
          "SEMANTIC_INDEX_NOT_READY",
        ]),
      }),
    }),
  ]),
);
const ResyncOutput = effectMcpSchema(
  Schema.Struct({
    scanned: NonnegativeInt,
    indexed: NonnegativeInt,
    unchanged: NonnegativeInt,
    deleted: NonnegativeInt,
    issues: Schema.Array(
      Schema.Struct({ path: Schema.String, code: Schema.String, message: Schema.String }),
    ),
    generation: NonnegativeInt,
  }),
);
const RelationNodeSchema = Schema.Struct({
  type: Schema.String,
  id: Schema.String,
  name: Schema.String,
  title: Schema.String,
});
const RelationEdgeSchema = Schema.Struct({
  direction: Schema.Literals(["incoming", "outgoing"]),
  kind: Schema.Literals(RELATION_KIND_NAMES),
  field: Schema.String,
  from: RelationNodeSchema,
  to: RelationNodeSchema,
  distance: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  affects: Schema.NullOr(Schema.Literals(["from", "to"])),
});
const RelationsOutput = effectMcpSchema(
  Schema.Struct({
    root: RelationNodeSchema,
    mode: Schema.Literals(["neighbors", "impact"]),
    edges: Schema.Array(RelationEdgeSchema),
    affected: Schema.Array(
      Schema.Struct({
        type: Schema.String,
        id: Schema.String,
        name: Schema.String,
        title: Schema.String,
        distance: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
        kind: Schema.Literals(RELATION_KIND_NAMES),
        via: Schema.Array(RelationNodeSchema),
      }),
    ),
    findings: Schema.Array(
      Schema.Struct({
        code: Schema.String,
        message: Schema.String,
        edge: Schema.optionalKey(
          Schema.Struct({
            kind: Schema.Literals(RELATION_KIND_NAMES),
            field: Schema.String,
            from: RelationNodeSchema,
            to: RelationNodeSchema,
          }),
        ),
        node: Schema.optionalKey(RelationNodeSchema),
      }),
    ),
    totalEdges: NonnegativeInt,
    truncated: Schema.Boolean,
    findingsTotal: NonnegativeInt,
    findingsTruncated: Schema.Boolean,
    complete: Schema.optionalKey(Schema.Literal(false)),
    issues: Schema.optionalKey(
      Schema.Array(Schema.Struct({ path: Schema.String, ...DocumentIssueSchema.fields })),
    ),
  }),
);
const DefinitionsInput = Schema.Struct({
  type: Schema.optionalKey(Schema.String).annotate({
    description: "Return only this registered type. Omit it for every registered type.",
  }),
});
/** The workflow every type shares, published once so each tool can point at it. */
const DEFINITION_GUIDANCE = [
  "Object ids are stable and unique within their type. Reads prefer a usable frontmatter id; otherwise a lowercase filename stem supplies an explicitly inferred identity. The scanner may align filenames only for validated objects, never for partial documents.",
  "Readable Markdown with missing, malformed or schema-incomplete frontmatter is returned as partial with recovered object fields, identity origin and issues; no dates, relations or other required domain fields are invented. Direct partial get includes the original raw text; includeBody:false listings omit both body and raw. Partial documents participate in search after reconciliation and are never automatically repaired or renamed.",
  "Use the type's get tool for a known id; do not list a whole type to find one object.",
  "Update and delete require a validated source revision and its latest checksum. Partial sources must be repaired explicitly before mutation; create/update inputs remain complete and schema-validated.",
  "Timestamps are supplied by the caller; the id and createdAt are immutable.",
  "Relation targets are not validated: a link to an object that does not exist is stored as written.",
  "The description field is a one-line summary; the body is the Markdown content.",
  "Search is not exhaustive: it is capped by topN and can miss a stale hit, so confirm a known id with get.",
  "Use objects_relations to answer what a change reaches and what justifies an object; it is the exact path for relation questions, where search is a heuristic.",
];
const DefinitionsOutput = effectMcpSchema(
  Schema.Struct({
    definitions: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        directory: Schema.String,
        description: Schema.String,
        schema: Schema.JsonObject,
      }),
    ),
    guidance: Schema.Array(Schema.String),
  }),
);
const StatusOutput = effectMcpSchema(Schema.JsonObject);
const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
/** The per-type tools repeat the workflow contract so a caller never needs another tool to use them. */
const WORKFLOW_CLAUSE = "See objects_definitions for the object model and workflow.";

function success(structuredContent: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

async function result(
  operation: () => Promise<Record<string, unknown>> | Record<string, unknown>,
): Promise<CallToolResult> {
  try {
    return success(await operation());
  } catch (cause) {
    const error =
      cause instanceof FrameworkError
        ? { code: cause.code, message: cause.message, details: cause.details }
        : cause instanceof Error && cause.name === "AbortError"
          ? { code: "CANCELLED", message: "The request was cancelled.", details: {} }
          : { code: "INTERNAL", message: "Tool execution failed.", details: {} };
    const structuredContent = { error };
    return { ...success(structuredContent), isError: true };
  }
}

/** The host owns the facade lifetime and reserves the generated tool names. */
export function registerObjectTools(
  server: McpServer,
  facade: ObjectFacade,
  options: McpToolOptions = {},
): void {
  let repairConfig: McpInputRepairConfig;
  try {
    if (
      options.inputRepair !== undefined &&
      (typeof options.inputRepair !== "object" ||
        options.inputRepair === null ||
        Array.isArray(options.inputRepair))
    ) {
      throw new TypeError("inputRepair must be an options object.");
    }
    repairConfig = Schema.decodeUnknownSync(McpInputRepairConfigSchema, {
      onExcessProperty: "error",
    })({
      ...defaultConfig.mcp.inputRepair,
      ...facade.config?.mcp.inputRepair,
      ...options.inputRepair,
    });
  } catch (cause) {
    throw new FrameworkError("CONFIG", "Invalid MCP input repair options.", {}, { cause });
  }
  const input = createMcpInputBoundary(repairConfig);
  const toolResult = async (
    args: object,
    operation: () => Promise<Record<string, unknown>> | Record<string, unknown>,
  ): Promise<CallToolResult> => {
    const repairs = input.takeRepairs(args);
    const response = await result(operation);
    return repairs?.length
      ? {
          ...response,
          _meta: { ...response._meta, "object-mcp/input-repair": { repairs } },
        }
      : response;
  };
  const registry = new ObjectRegistry(facade.definitions);
  const configuredSearch = facade.config?.search;
  const effectiveSearch: EffectiveSearch = {
    maxTopN: configuredSearch?.maxTopN ?? defaultConfig.search.maxTopN,
    defaultTopN: configuredSearch?.defaultTopN ?? defaultConfig.search.defaultTopN,
  };
  const {
    list: listInput,
    search: searchInput,
    relations: relationsInput,
  } = buildInputSchemas(
    effectiveSearch,
    registry.definitions.map((definition) => definition.name),
  );
  const encodeStored = (stored: ReadObject, includeBody = true): Record<string, unknown> => {
    if (stored.partial) {
      return {
        partial: true,
        type: stored.type,
        object: stored.object,
        ...(includeBody ? { body: stored.body, raw: stored.raw } : {}),
        path: stored.path,
        checksum: stored.checksum,
        issues: stored.issues,
        identity: stored.identity,
        ...(stored.assurance === undefined ? {} : { assurance: stored.assurance }),
      };
    }
    return {
      type: stored.type,
      object: registry.encode(stored.type, stored.object),
      ...(includeBody ? { body: stored.body } : {}),
      path: stored.path,
      checksum: stored.checksum,
      ...(stored.assurance === undefined ? {} : { assurance: stored.assurance }),
    };
  };

  for (const definition of registry.definitions) {
    const storedSchema = Schema.Struct({
      type: Schema.Literal(definition.name),
      object: definition.schema,
      body: Schema.String,
      path: Schema.String,
      checksum: Schema.String,
    });
    const storedOutput = effectMcpSchema(storedSchema);
    const readStoredSchema = Schema.Struct({
      ...storedSchema.fields,
      assurance: Schema.optionalKey(SourceIdentityAssuranceSchema),
    });
    const partialSchema = Schema.Struct({
      ...storedSchema.fields,
      ...PartialReadFields,
      assurance: Schema.optionalKey(SourceIdentityAssuranceSchema),
      body: Schema.String,
      raw: Schema.String,
    });
    const readOutput = effectMcpSchema(Schema.Union([readStoredSchema, partialSchema]));
    server.registerTool(
      `${definition.name}_create`,
      {
        description: `Create one ${definition.name} Markdown file. Supply all object fields, including timestamps and nullable fields. Identifiers are lowercased and must be portable file names. Omitted body defaults to an empty string. ${definition.description} ${WORKFLOW_CLAUSE}`,
        inputSchema: input.schema(
          Schema.Struct({
            object: definition.schema.annotate({
              description:
                "The complete object. Identifiers are lowercased and must be portable file names.",
            }),
            body: Schema.optionalKey(Schema.String),
          }),
        ),
        outputSchema: storedOutput,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      (args, ctx) =>
        toolResult(args, async () =>
          encodeStored(
            await facade.create(definition.name, args.object, args.body, ctx.mcpReq.signal),
          ),
        ),
    );

    server.registerTool(
      `${definition.name}_get`,
      {
        description: `Read one ${definition.name} directly from its Markdown file and return its checksum. Partial or recoverable documents (missing, broken or incomplete frontmatter) are included when readable; identity uses the registered directory and, if needed, the filename stem as an explicitly inferred fallback. No automatic source repair or rename occurs. ${WORKFLOW_CLAUSE}`,
        inputSchema: input.schema(IdInput),
        outputSchema: readOutput,
        annotations: readOnly,
      },
      (args, ctx) =>
        toolResult(args, async () =>
          encodeStored(await facade.get(definition.name, args.id, ctx.mcpReq.signal)),
        ),
    );

    server.registerTool(
      `${definition.name}_update`,
      {
        description: `Replace a complete ${definition.name} object and Markdown body. The identifier and createdAt timestamp are immutable. Identifiers are lowercased and must be portable file names. Supply the latest checksum and your updatedAt timestamp. ${WORKFLOW_CLAUSE}`,
        inputSchema: input.schema(
          Schema.Struct({
            id: Schema.NonEmptyString.annotate({
              description:
                "Object identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
            }),
            object: definition.schema.annotate({
              description:
                "The complete object. Identifiers are lowercased and must be portable file names.",
            }),
            body: Schema.String,
            expectedChecksum: Schema.NonEmptyString.annotate({
              description: "Checksum of the revision being replaced.",
            }),
          }),
        ),
        outputSchema: storedOutput,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      (args, ctx) =>
        toolResult(args, async () =>
          encodeStored(
            await facade.update(
              definition.name,
              args.id,
              args.object,
              args.body,
              args.expectedChecksum,
              ctx.mcpReq.signal,
            ),
          ),
        ),
    );

    server.registerTool(
      `${definition.name}_delete`,
      {
        description: `Delete a ${definition.name} Markdown file and its derived search data. Supply its latest checksum. ${WORKFLOW_CLAUSE}`,
        inputSchema: input.schema(DeleteInput),
        outputSchema: effectMcpSchema(
          Schema.Struct({
            type: Schema.Literal(definition.name),
            id: Schema.String,
            deleted: Schema.Literal(true),
          }),
        ),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      (args, ctx) =>
        toolResult(args, () =>
          facade.delete(definition.name, args.id, args.expectedChecksum, ctx.mcpReq.signal),
        ),
    );

    server.registerTool(
      `${definition.name}_list`,
      {
        description: `List ${definition.name} objects read from the filesystem, in identifier order. Partial or recoverable documents are included when readable; identity uses the registered directory and, if needed, the filename stem as an explicitly inferred fallback. Set includeBody to false to omit the Markdown body; reduced listings also omit partial raw content, which remains available on direct get. A retired object is still listed; check its retiredAt field to exclude it. If discovery is incomplete (unreadable sources, conflicts, or non-semantic issues), listing returns complete:false with total:null, observedCount, issues, and pagination continuation; it never claims a complete total when sources were unreadable. No automatic repair or rename of partial files occurs during listing or resync. ${WORKFLOW_CLAUSE}`,
        inputSchema: input.schema(listInput),
        outputSchema: effectMcpSchema(
          Schema.Union([
            Schema.Struct({
              objects: Schema.Array(
                Schema.Union([
                  Schema.Struct({
                    ...readStoredSchema.fields,
                    body: Schema.optionalKey(Schema.String),
                  }),
                  Schema.Struct({
                    ...partialSchema.fields,
                    body: Schema.optionalKey(Schema.String),
                    raw: Schema.optionalKey(Schema.String),
                  }),
                ]),
              ),
              total: NonnegativeInt,
              complete: Schema.optionalKey(Schema.Literal(true)),
              observedCount: Schema.optionalKey(NonnegativeInt),
              issues: Schema.optionalKey(
                Schema.Array(
                  Schema.Struct({
                    path: Schema.String,
                    code: Schema.String,
                    message: Schema.String,
                  }),
                ),
              ),
              continuation: Schema.optionalKey(
                Schema.NullOr(Schema.Struct({ offset: NonnegativeInt })),
              ),
            }),
            Schema.Struct({
              objects: Schema.Array(
                Schema.Union([
                  Schema.Struct({
                    ...readStoredSchema.fields,
                    body: Schema.optionalKey(Schema.String),
                  }),
                  Schema.Struct({
                    ...partialSchema.fields,
                    body: Schema.optionalKey(Schema.String),
                    raw: Schema.optionalKey(Schema.String),
                  }),
                ]),
              ),
              total: Schema.Null,
              complete: Schema.Literal(false),
              observedCount: NonnegativeInt,
              issues: Schema.Array(
                Schema.Struct({
                  path: Schema.String,
                  code: Schema.String,
                  message: Schema.String,
                }),
              ),
              continuation: Schema.NullOr(Schema.Struct({ offset: NonnegativeInt })),
            }),
          ]),
        ),
        annotations: readOnly,
      },
      (args, ctx) =>
        toolResult(args, async () => {
          const listed = await facade.list(definition.name, args, ctx.mcpReq.signal);
          const includeBody = args.includeBody ?? true;
          return {
            ...listed,
            objects: listed.objects.map((stored) => encodeStored(stored, includeBody)),
          };
        }),
    );
  }

  server.registerTool(
    "objects_search",
    {
      description:
        "Search distinct objects in the derived SQLite index using full-text, semantic or hybrid ranking, including readable partial documents. Missing or malformed frontmatter does not by itself exclude a document; partial hits expose recovered fields, identity origin and issues. Display label fallbacks are derived, not validated source facts. Search is not exhaustive: topN is a maximum, recent objects may be absent, and stale or unreadable candidates are omitted without refill. Use the type's get tool for a known id and fully paginate its source-backed list to enumerate readable objects. The server's startup reconciliation runs in the background, so a search issued right after it starts may find nothing; objects_status reports whether a synchronization is still running. The body field is omitted unless includeBody is true; search never returns a dedicated raw field. `fulltextExcerpt` can disclose name/title text or raw YAML frontmatter and Markdown body content, including a complete short document, even when `includeBody` is omitted or false; its size limit is not redaction.",
      inputSchema: input.schema(searchInput),
      outputSchema: SearchOutput,
      annotations: readOnly,
    },
    (args, ctx) =>
      toolResult(args, async () => ({ ...(await facade.search(args, ctx.mcpReq.signal)) })),
  );

  server.registerTool(
    "objects_relations",
    {
      description:
        "Read the relation graph around one object: what a change reaches, and what justifies a change. Use it for 'what breaks if I changed this decision' and 'which decisions should I review if that scenario is changed'. The graph is read from the Markdown sources, so the answer reflects the vault on disk. The mode 'neighbors' returns relation edges up to the requested depth; 'outgoing' follows each stored edge from source to target, 'incoming' follows it from target to source, and 'both' follows either. An edge is reported with the direction of the walk that first reached it, so the label remains stable at every depth. The mode 'impact' returns the objects a change to the root reaches, following the relation kind: a change to the target of a depends, justifies, contains or owns relation propagates to the holder, and a change to the holder of a uses relation propagates to the target. The impact mode derives its direction from the kind and rejects the direction argument. The edgeKinds filter defaults to depends, uses and justifies in the impact mode, because contains and owns are organizational and relates carries no impact. The findings array reports the link defects the model does not prevent: DANGLING_TARGET, TARGET_TYPE_MISMATCH, AMBIGUOUS_TARGET and CYCLE. A finding is reported only when the defect lies within the queried depth. A target that names no object is not an object, so it is not in the affected set, while its edge and its finding still report the broken link. Readable partial sources contribute only safely recovered, descriptor-shaped relation fields; their warnings are returned in issues with complete:false rather than claiming a complete graph. Unreadable or duplicated source objects still refuse the query with SCAN, DUPLICATE_ID or SOURCE_CONFLICT.",
      inputSchema: input.schema(relationsInput),
      outputSchema: RelationsOutput,
      annotations: readOnly,
    },
    (args, ctx) =>
      toolResult(args, async () => ({ ...(await facade.relations(args, ctx.mcpReq.signal)) })),
  );

  server.registerTool(
    "objects_resync",
    {
      description:
        "Reconcile the SQLite metadata, full-text index, and embeddings against all registered Markdown directories. Source files remain authoritative; parse or embedding failures are reported.",
      inputSchema: input.schema(EmptyInput),
      outputSchema: ResyncOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args, ctx) => toolResult(args, async () => ({ ...(await facade.resync(ctx.mcpReq.signal)) })),
  );

  server.registerTool(
    "objects_status",
    {
      description:
        "Show index and synchronization state, embedding configuration/identity, last reports, and bounded known issues with totals, truncation and per-code counts. This call neither checks model files nor runs inference. Provider metadata, zero pending embeddings and dirty: false do not prove future inference success or complete discovery. objects_resync writes derived state and returns the full issue list.",
      inputSchema: input.schema(EmptyInput),
      outputSchema: StatusOutput,
      annotations: readOnly,
    },
    (args) => toolResult(args, () => facade.status()),
  );

  server.registerTool(
    "objects_definitions",
    {
      description:
        "List the registered object types and canonical JSON schemas generated from their Effect definitions, optionally filtered to one type, together with the shared object-model and workflow contract. Dates are ISO strings on the wire and in YAML.",
      inputSchema: input.schema(DefinitionsInput),
      outputSchema: DefinitionsOutput,
      annotations: readOnly,
    },
    (args) =>
      toolResult(args, () => {
        // An unknown type fails with the registry's own error so the caller learns the registered names.
        const selected = args.type ? [registry.get(args.type)] : registry.definitions;
        return {
          definitions: selected.map((definition) => ({
            name: definition.name,
            directory: definition.directory,
            description: definition.description,
            schema: registry.jsonSchema(definition.name),
          })),
          guidance: [...DEFINITION_GUIDANCE],
        };
      }),
  );
}

/** The caller owns the facade lifetime, so closing one transport does not stop other clients. */
export function createMcpServer(
  facade: ObjectFacade,
  info: { name: string; version: string } = { name: "object-mcp", version: "0.1.0" },
  options: McpToolOptions = {},
): McpServer {
  const server = new McpServer(info);
  registerObjectTools(server, facade, options);
  return server;
}
