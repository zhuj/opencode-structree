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
  type StoredObject,
} from "./types";

export { effectMcpSchema } from "./mcp-input.ts";

export interface McpToolOptions {
  readonly inputRepair?: Partial<McpInputRepairConfig>;
}

const IdInput = Schema.Struct({
  id: Schema.NonEmptyString.annotate({ description: "Object identifier. Must not be empty." }),
});
// An empty Effect Struct also accepts non-objects; a string-keyed Never record accepts only {}.
const EmptyInput = Schema.Record(Schema.String, Schema.Never);
const NonnegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const DeleteInput = Schema.Struct({
  id: Schema.NonEmptyString.annotate({ description: "Object identifier. Must not be empty." }),
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
  };
}
const SearchOutput = effectMcpSchema(
  Schema.Struct({
    mode: Schema.Literals(["fulltext", "semantic", "hybrid"]),
    hits: Schema.Array(
      Schema.Struct({
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
      }),
    ),
    indexGeneration: NonnegativeInt,
  }),
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
const DefinitionsInput = Schema.Struct({
  type: Schema.optionalKey(Schema.String).annotate({
    description: "Return only this registered type. Omit it for every registered type.",
  }),
});
/** The workflow every type shares, published once so each tool can point at it. */
const DEFINITION_GUIDANCE = [
  "Object ids are stable, unique within their type, and are the only handle: the file name is a hash of the id.",
  "Use the type's get tool for a known id; do not list a whole type to find one object.",
  "Update and delete replace the whole revision and require the checksum returned by the latest get, list, create or update.",
  "Timestamps are supplied by the caller; the id and createdAt are immutable.",
  "Relation targets are not validated: a link to an object that does not exist is stored as written.",
  "The description field is a one-line summary; the body is the Markdown content.",
  "Search is not exhaustive: it is capped by topN and can miss a stale hit, so confirm a known id with get.",
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
  const { list: listInput, search: searchInput } = buildInputSchemas(
    effectiveSearch,
    registry.definitions.map((definition) => definition.name),
  );
  const encodeStored = (stored: StoredObject, includeBody = true): Record<string, unknown> => ({
    type: stored.type,
    object: registry.encode(stored.type, stored.object),
    ...(includeBody ? { body: stored.body } : {}),
    path: stored.path,
    checksum: stored.checksum,
  });

  for (const definition of registry.definitions) {
    const storedSchema = Schema.Struct({
      type: Schema.Literal(definition.name),
      object: definition.schema,
      body: Schema.String,
      path: Schema.String,
      checksum: Schema.String,
    });
    const storedOutput = effectMcpSchema(storedSchema);
    server.registerTool(
      `${definition.name}_create`,
      {
        description: `Create one ${definition.name} Markdown file. Supply all object fields, including timestamps and nullable fields. Identifiers must not be empty. Omitted body defaults to an empty string. ${definition.description} ${WORKFLOW_CLAUSE}`,
        inputSchema: input.schema(
          Schema.Struct({
            object: definition.schema.annotate({
              description: "The complete object. Identifiers must not be empty.",
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
        description: `Read one ${definition.name} directly from its Markdown file and return its checksum. ${WORKFLOW_CLAUSE}`,
        inputSchema: input.schema(IdInput),
        outputSchema: storedOutput,
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
        description: `Replace a complete ${definition.name} object and Markdown body. The identifier and createdAt timestamp are immutable. Identifiers must not be empty. Supply the latest checksum and your updatedAt timestamp. ${WORKFLOW_CLAUSE}`,
        inputSchema: input.schema(
          Schema.Struct({
            id: Schema.NonEmptyString.annotate({
              description: "Object identifier. Must not be empty.",
            }),
            object: definition.schema.annotate({
              description: "The complete object. Identifiers must not be empty.",
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
        description: `List ${definition.name} objects read from the filesystem, in identifier order. A retired object is still listed; check its retiredAt field to exclude it. Set includeBody to false to omit the Markdown body and return only identity, title, path and checksum. ${WORKFLOW_CLAUSE}`,
        inputSchema: input.schema(listInput),
        outputSchema: effectMcpSchema(
          Schema.Struct({
            // The list output is the stored shape without the body, so the two cannot drift apart.
            objects: Schema.Array(
              Schema.Struct({
                ...storedSchema.fields,
                body: Schema.optionalKey(Schema.String),
              }),
            ),
            total: NonnegativeInt,
          }),
        ),
        annotations: readOnly,
      },
      (args, ctx) =>
        toolResult(args, async () => {
          const listed = await facade.list(definition.name, args, ctx.mcpReq.signal);
          const includeBody = args.includeBody ?? true;
          return {
            objects: listed.objects.map((stored) => encodeStored(stored, includeBody)),
            total: listed.total,
          };
        }),
    );
  }

  server.registerTool(
    "objects_search",
    {
      description:
        "Search distinct objects in the derived SQLite index using full-text, semantic or hybrid ranking. Search is not exhaustive: topN is a maximum, recent or invalid objects may be absent, and stale or unreadable candidates are omitted without refill. Use the type's get tool for a known id and fully paginate its source-backed list to enumerate valid objects. The body field is omitted unless includeBody is true. `fulltextExcerpt` can disclose name/title text or raw YAML frontmatter and Markdown body content, including a complete short document, even when `includeBody` is omitted or false; its size limit is not redaction.",
      inputSchema: input.schema(searchInput),
      outputSchema: SearchOutput,
      annotations: readOnly,
    },
    (args, ctx) =>
      toolResult(args, async () => ({ ...(await facade.search(args, ctx.mcpReq.signal)) })),
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
