import type { McpServer } from "@modelcontextprotocol/server";
import { Schema } from "effect";
import { defaultConfig } from "../lib/config.ts";
import { effectMcpSchema } from "../lib/mcp-input.ts";
import { createMcpToolContext, type McpToolOptions } from "../lib/mcp-tool-context.ts";
import { LIST_LIMIT_MAX, type ObjectFacade } from "../lib/types.ts";
import { ObjectFieldTimestampSchema } from "../object-fields/schemas.ts";
import { setMemoryStatus } from "./lifecycle.ts";
import { isMemoryDefinition } from "./registry.ts";
import { memoryContext, memorySearch } from "./retrieval.ts";
import { MemoryCategorySchema, MemoryDateSchema, MemoryStatusSchema } from "./schemas/index.ts";
import {
  MemoryContextOutputSchema,
  MemoryRelatedOutputSchema,
  MemorySearchOutputSchema,
  MemoryStatusOutputSchema,
} from "./tool-schemas.ts";

const filters = {
  category: Schema.optionalKey(MemoryCategorySchema),
  status: Schema.optionalKey(MemoryStatusSchema).annotate({
    description: "Exact lifecycle filter. Defaults to active, not an assertion of truth.",
  }),
  label: Schema.optionalKey(Schema.String),
  includeRetired: Schema.optionalKey(Schema.Boolean),
};
const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** Application-only tools require the actual memory schema and its relation semantics. */
export function registerMemoryTools(
  server: McpServer,
  facade: ObjectFacade,
  options: McpToolOptions = {},
): void {
  if (!facade.definitions.some(isMemoryDefinition)) return;
  const { input, toolResult, encodeStored } = createMcpToolContext(facade, options);
  server.registerTool(
    "memory_context",
    {
      description:
        "Read one source-backed memory page, then apply exact category/status/label filters. Defaults to active, nonretired entries. Source totals/continuation count unfiltered sources, never matches; an empty filtered page is not proof of absence. Partial sources are diagnostics, never guidance. currentGuidance requires valid active nonretired source but does not establish relevance or truth; uncertainty marks investigations even when active. No indexes, repairs, defaults or automatic expiration. reviewDue is null unless asOf and a nonempty reviewAfter are supplied; true only after that date. Fully paginate memory_list to enumerate source objects.",
      inputSchema: input.schema(
        Schema.Struct({
          ...filters,
          limit: Schema.optionalKey(
            Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: LIST_LIMIT_MAX })),
          ),
          offset: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
          asOf: Schema.optionalKey(MemoryDateSchema),
        }),
      ),
      outputSchema: effectMcpSchema(MemoryContextOutputSchema),
      annotations: readOnly,
    },
    (args, ctx) => toolResult(args, () => memoryContext(facade, args, ctx.mcpReq.signal)),
  );
  server.registerTool(
    "memory_search",
    {
      description:
        "Search only the memory type; defaults to fulltext. Requires nonblank content text, not enumeration. Framework fulltext uses Unicode tokens with AND, no phrase/prefix/operators, at most 128 tokens, bounded excerpts (not redaction), and existing chunk limits. Exact category/status/label filters and retirement exclusion apply AFTER bounded topN candidates with NO refill; results are nonexhaustive. Defaults to active/nonretired. Rechecks source revision; partial/changed sources are diagnostics, not guidance. Investigations remain uncertain. Explicit semantic/hybrid mode requires configured embeddings and the normal framework permissions; no model/cache setup is performed here.",
      inputSchema: input.schema(
        Schema.Struct({
          ...filters,
          query: Schema.String.check(
            Schema.makeFilter((value) => value.trim().length > 0, {
              message: "Supply nonblank search text.",
              toJsonSchema: () => ({ minLength: 1 }),
            }),
          ),
          mode: Schema.optionalKey(Schema.Literals(["fulltext", "semantic", "hybrid"])),
          topN: Schema.optionalKey(
            Schema.Int.check(
              Schema.isBetween({
                minimum: 1,
                maximum: facade.config?.search?.maxTopN ?? defaultConfig.search.maxTopN,
              }),
            ),
          ),
          includeBody: Schema.optionalKey(Schema.Boolean),
        }),
      ),
      outputSchema: effectMcpSchema(MemorySearchOutputSchema),
      annotations: readOnly,
    },
    (args, ctx) => toolResult(args, () => memorySearch(facade, args, ctx.mcpReq.signal)),
  );
  server.registerTool(
    "memory_related",
    {
      description:
        "Follow stored outgoing memory relations, neighbors only, depth 1 (default) or 2. Preserves graph edges, labels, findings and source completeness. No inferred reverse edges, status changes or target repair. buildsOn is depends; implements/motivatedBy/validatedBy are justifies (review invalidation, not runtime proof); supersedes/contradicts/relatedTo/constrains are tracing-only relates. Citations and associations do not prove execution or acceptance.",
      inputSchema: input.schema(
        Schema.Struct({
          id: Schema.NonEmptyString,
          depth: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 2 }))),
          includeRetired: Schema.optionalKey(Schema.Boolean).annotate({
            description: "Defaults to true to preserve stored graph facts.",
          }),
        }),
      ),
      outputSchema: effectMcpSchema(MemoryRelatedOutputSchema),
      annotations: readOnly,
    },
    (args, ctx) =>
      toolResult(args, async () => ({
        ...(await facade.relations(
          {
            type: "memory",
            id: args.id,
            mode: "neighbors",
            direction: "outgoing",
            depth: args.depth ?? 1,
            includeRetired: args.includeRetired ?? true,
          },
          ctx.mcpReq.signal,
        )),
      })),
  );
  server.registerTool(
    "memory_set_status",
    {
      description:
        "Change one complete memory source's lifecycle, requiring matching from status, latest expectedChecksum, caller-owned updatedAt and nonblank reason. Preserves all other fields/body and appends a concise dated lifecycle note. Any explicit lifecycle pair is allowed; does not verify truth, set confidence/retiredAt, accept a decision, change targets or add backlinks. Concurrent changes are refused by normal guarded update. Partial sources are refused, never repaired.",
      inputSchema: input.schema(
        Schema.Struct({
          id: Schema.NonEmptyString,
          from: MemoryStatusSchema,
          to: MemoryStatusSchema,
          reason: Schema.String.check(
            Schema.makeFilter((value) => value.trim().length > 0, {
              message: "Supply a nonblank lifecycle reason.",
              toJsonSchema: () => ({ minLength: 1 }),
            }),
          ),
          updatedAt: ObjectFieldTimestampSchema,
          expectedChecksum: Schema.NonEmptyString,
        }),
      ),
      outputSchema: effectMcpSchema(MemoryStatusOutputSchema),
      annotations: {
        ...readOnly,
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    (args, ctx) =>
      toolResult(args, async () =>
        encodeStored(await setMemoryStatus(facade, args, ctx.mcpReq.signal)),
      ),
  );
}
