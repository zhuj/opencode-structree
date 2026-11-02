import type { McpServer } from "@modelcontextprotocol/server";
import { Schema } from "effect";
import { FrameworkError } from "./lib/errors.ts";
import { effectMcpSchema } from "./lib/mcp-input.ts";
import { createMcpToolContext, type McpToolOptions } from "./lib/mcp-tool-context.ts";
import type { ObjectFacade } from "./lib/types.ts";
import { isMemoryDefinition } from "./memory/registry.ts";
import { memoryRecall } from "./memory/workflows-read.ts";
import { resumeProgress } from "./progress/reads.ts";
import { isProgressDefinition } from "./progress/registry.ts";
import { progressText, WorkItemIDSchema } from "./progress/schemas.ts";
import { ProgressResumeOutputSchema } from "./progress/tool-schemas.ts";

export const SessionContextRequestSchema = Schema.Struct({
  id: WorkItemIDSchema,
  query: Schema.optionalKey(progressText(2000)),
});
export type SessionContextRequest = typeof SessionContextRequestSchema.Type;
export const SessionContextOutputSchema = Schema.Struct({
  work: ProgressResumeOutputSchema,
  knowledge: Schema.NullOr(Schema.JsonObject),
  knowledgeRequested: Schema.Boolean,
  knowledgeStatus: Schema.Literals(["not-requested", "recalled"]),
  limitations: Schema.Array(Schema.String),
});

function hasSessionDomains(facade: ObjectFacade): boolean {
  return (
    facade.definitions.some(isProgressDefinition) && facade.definitions.some(isMemoryDefinition)
  );
}

/** Knowledge retrieval is explicit: long outcomes are not transformed into restrictive token-AND queries. */
export async function sessionContext(
  facade: ObjectFacade,
  request: SessionContextRequest,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (!hasSessionDomains(facade))
    throw new FrameworkError(
      "CONFIG",
      "Session context requires the actual work-item and memory domain definitions.",
    );
  const input = Schema.decodeUnknownSync(SessionContextRequestSchema, {
    onExcessProperty: "error",
  })(request);
  const work = await resumeProgress(facade, { id: input.id }, signal);
  signal?.throwIfAborted();
  const knowledge =
    input.query === undefined ? null : await memoryRecall(facade, { query: input.query }, signal);
  return {
    work,
    knowledge,
    knowledgeRequested: input.query !== undefined,
    knowledgeStatus: input.query === undefined ? "not-requested" : "recalled",
    limitations: [
      "Read-only handoff: no status transition, test execution, verification or acceptance is inferred.",
      "Work and knowledge are independent source reads, not a cross-source snapshot.",
      input.query === undefined
        ? "Knowledge was not requested; no memory scan was performed. Null does not establish absence of relevant knowledge."
        : "Knowledge recall is bounded lexical matching over active, nonretired memories. Guidance is authored, not proof; empty results do not establish absence.",
    ],
  };
}

/** Unified application handoff is available only when both canonical domain contracts are installed. */
export function registerSessionContextTool(
  server: McpServer,
  facade: ObjectFacade,
  options: McpToolOptions = {},
): void {
  if (!hasSessionDomains(facade)) return;
  const { input, toolResult } = createMcpToolContext(facade, options);
  server.registerTool(
    "session_context",
    {
      description:
        "Read a known work-item handoff by required id, without activating it. Returns work objective, checkpoints, blockers/dependencies and explicit verification gaps. Supply query only when knowledge recall is wanted: bounded lexical recall defaults to active/nonretired memories. Without query, knowledge is null/not-requested, never evidence of absence. No writes, model calls, tests or automatic acceptance.",
      inputSchema: input.schema(SessionContextRequestSchema),
      outputSchema: effectMcpSchema(SessionContextOutputSchema),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args, ctx) => toolResult(args, () => sessionContext(facade, args, ctx.mcpReq.signal)),
  );
}
