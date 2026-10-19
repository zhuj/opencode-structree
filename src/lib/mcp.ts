import { type CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { Schema } from "effect";
import { defaultConfig, McpInputRepairConfigSchema } from "./config.ts";
import { FrameworkError } from "./errors";
import { createMcpInputBoundary, effectMcpSchema } from "./mcp-input.ts";
import { ObjectRegistry } from "./registry";
import type { McpInputRepairConfig, ObjectFacade, StoredObject } from "./types";

export { effectMcpSchema } from "./mcp-input.ts";

export interface McpToolOptions {
  readonly inputRepair?: Partial<McpInputRepairConfig>;
}

const IdInput = Schema.Struct({
  id: Schema.String.annotate({ description: "Object identifier." }),
});
// An empty Effect Struct also accepts non-objects; a string-keyed Never record accepts only {}.
const EmptyInput = Schema.Record(Schema.String, Schema.Never);
const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
const NonnegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const ListInput = Schema.Struct({
  limit: Schema.optionalKey(PositiveInt).annotate({ description: "Maximum objects to return." }),
  offset: Schema.optionalKey(NonnegativeInt).annotate({
    description: "Number of objects to skip in identifier order.",
  }),
});
const DeleteInput = Schema.Struct({
  id: Schema.String,
  expectedChecksum: Schema.NonEmptyString.annotate({
    description:
      "Checksum returned by the latest get/list/create/update; prevents overwriting a newer revision.",
  }),
});
const SearchInput = Schema.Struct({
  query: Schema.NonEmptyString.annotate({
    description: "Search text. Full-text mode treats words literally, without raw FTS operators.",
  }),
  mode: Schema.optionalKey(Schema.Literals(["fulltext", "semantic", "hybrid"])).annotate({
    description: "Full-text, semantic, or hybrid search.",
  }),
  types: Schema.optionalKey(Schema.Array(Schema.String)).annotate({
    description: "Optional subset of registered type names. An empty array searches no types.",
  }),
  topN: Schema.optionalKey(PositiveInt).annotate({
    description: "Maximum number of distinct matching objects, subject to the configured limit.",
  }),
  includeBody: Schema.optionalKey(Schema.Boolean).annotate({
    description: "Include each matched object's complete Markdown body.",
  }),
});
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
  }),
);
const StatusOutput = effectMcpSchema(Schema.JsonObject);
const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

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
  const encodeStored = (stored: StoredObject): Record<string, unknown> => ({
    type: stored.type,
    object: registry.encode(stored.type, stored.object),
    body: stored.body,
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
        description: `Create one ${definition.name} Markdown file. Supply all object fields, including timestamps and nullable fields. Omitted body defaults to an empty string. ${definition.description}`,
        inputSchema: input.schema(
          Schema.Struct({ object: definition.schema, body: Schema.optionalKey(Schema.String) }),
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
        description: `Read one ${definition.name} directly from its Markdown file and return its checksum.`,
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
        description: `Replace a complete ${definition.name} object and Markdown body. The identifier and createdAt timestamp are immutable. Supply the latest checksum and your updatedAt timestamp.`,
        inputSchema: input.schema(
          Schema.Struct({
            id: Schema.String,
            object: definition.schema,
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
        description: `Delete a ${definition.name} Markdown file and its derived search data. Supply its latest checksum.`,
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
        description: `List ${definition.name} objects read from the filesystem, in identifier order.`,
        inputSchema: input.schema(ListInput),
        outputSchema: effectMcpSchema(
          Schema.Struct({ objects: Schema.Array(storedSchema), total: NonnegativeInt }),
        ),
        annotations: readOnly,
      },
      (args, ctx) =>
        toolResult(args, async () => {
          const listed = await facade.list(definition.name, args, ctx.mcpReq.signal);
          return { objects: listed.objects.map(encodeStored), total: listed.total };
        }),
    );
  }

  server.registerTool(
    "objects_search",
    {
      description:
        "Search distinct objects using literal full-text, semantic embeddings, or hybrid reciprocal-rank fusion. Optional types restrict both ranking methods before limits. Search uses the synchronized, rebuildable SQLite index.",
      inputSchema: input.schema(SearchInput),
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
      description: "Show the current index, synchronization, and embedding-provider status.",
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
        "List the registered object types and canonical JSON schemas generated from their Effect definitions. Dates are ISO strings on the wire and in YAML.",
      inputSchema: input.schema(EmptyInput),
      outputSchema: DefinitionsOutput,
      annotations: readOnly,
    },
    (args) =>
      toolResult(args, () => ({
        definitions: registry.definitions.map((definition) => ({
          name: definition.name,
          directory: definition.directory,
          description: definition.description,
          schema: registry.jsonSchema(definition.name),
        })),
      })),
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
