import type { McpServer } from "@modelcontextprotocol/server";
import { effectMcpSchema } from "../lib/mcp-input.ts";
import { createMcpToolContext, type McpToolOptions } from "../lib/mcp-tool-context.ts";
import type { ObjectFacade } from "../lib/types.ts";
import { planProgress, updateProgress } from "./mutations.ts";
import { resumeProgress, reviewProgress } from "./reads.ts";
import { isProgressDefinition } from "./registry.ts";
import {
  ProgressPlanRequestSchema,
  ProgressResumeRequestSchema,
  ProgressReviewRequestSchema,
  ProgressUpdateRequestSchema,
} from "./requests.ts";
import {
  ProgressResumeOutputSchema,
  ProgressReviewOutputSchema,
  ProgressSummarySchema,
} from "./tool-schemas.ts";

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** Intent tools are application-only and require the actual work-item schema and relation contract. */
export function registerProgressTools(
  server: McpServer,
  facade: ObjectFacade,
  options: McpToolOptions = {},
): void {
  if (!facade.definitions.some(isProgressDefinition)) return;
  const { input, toolResult } = createMcpToolContext(facade, options);
  server.registerTool(
    "progress_plan",
    {
      description:
        "Plan resumable work from a title and intended outcome; acceptance, explicit owner and parent/dependencies are optional. Server owns id/name/time and planned status. No mandatory project hierarchy, inferred verification, test execution or durable-memory promotion. Returns a compact objective and checksum.",
      inputSchema: input.schema(ProgressPlanRequestSchema),
      outputSchema: effectMcpSchema(ProgressSummarySchema),
      annotations: { ...readOnly, readOnlyHint: false, idempotentHint: false },
    },
    (args, ctx) => toolResult(args, () => planProgress(facade, args, ctx.mcpReq.signal)),
  );
  server.registerTool(
    "progress_update",
    {
      description:
        "Guard one work item with its latest expectedChecksum. Preserve unspecified fields/body; append one bounded checkpoint, never truncate history. Blocked requires blockers and nextAction. Explicit empty blockers/dependencies clear those fields, parentId:null unparents; no silent clears. Passed verification requires explicit evidence/test result and never means acceptance is established. Known dependency/parent cycles fail; missing/partial references remain unknown. No target updates or test execution.",
      inputSchema: input.schema(ProgressUpdateRequestSchema),
      outputSchema: effectMcpSchema(ProgressSummarySchema),
      annotations: {
        ...readOnly,
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    (args, ctx) => toolResult(args, () => updateProgress(facade, args, ctx.mcpReq.signal)),
  );
  server.registerTool(
    "progress_resume",
    {
      description:
        "Read one work item by id without activating it. Return the full objective/acceptance, latest five checkpoints and total count, blockers, nextAction, verification gaps and source-backed dependency readiness. Completed with pending verification remains explicitly unverified. Missing/partial targets and graph cycles are findings, never completion. Graph inspection is bounded to 200 sources. No writes, models, repairs, or memory promotion.",
      inputSchema: input.schema(ProgressResumeRequestSchema),
      outputSchema: effectMcpSchema(ProgressResumeOutputSchema),
      annotations: readOnly,
    },
    (args, ctx) => toolResult(args, () => resumeProgress(facade, args, ctx.mcpReq.signal)),
  );
  server.registerTool(
    "progress_review",
    {
      description:
        "Discover current work from one bounded source page (20 default, 100 max). Defaults to planned/active/paused/blocked, excluding retired; optional exact status/owner filters. Filters apply after scanning, with no refill. source.total/continuation count sources, never matching items; partial sources are diagnostics. Empty filtered pages do not prove absence. No writes, models, activation, or implicit verification.",
      inputSchema: input.schema(ProgressReviewRequestSchema),
      outputSchema: effectMcpSchema(ProgressReviewOutputSchema),
      annotations: readOnly,
    },
    (args, ctx) => toolResult(args, () => reviewProgress(facade, args, ctx.mcpReq.signal)),
  );
}
