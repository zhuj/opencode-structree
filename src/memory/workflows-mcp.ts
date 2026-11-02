import type { McpServer } from "@modelcontextprotocol/server";
import { createMcpToolContext, type McpToolOptions } from "../lib/mcp-tool-context.ts";
import type { ObjectFacade } from "../lib/types.ts";
import { isMemoryDefinition } from "./registry.ts";
import {
  RecallMemorySchema,
  RememberMemorySchema,
  ReviewMemorySchema,
  ReviseMemorySchema,
} from "./workflow-schemas.ts";
import { memoryRecall, memoryReview } from "./workflows-read.ts";
import { rememberMemory, reviseMemory } from "./workflows-write.ts";

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const write = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

/** Compact intent tools; generic CRUD remains available for advanced authored fields. */
export function registerMemoryWorkflowTools(
  server: McpServer,
  facade: ObjectFacade,
  options: McpToolOptions = {},
): void {
  if (!facade.definitions.some(isMemoryDefinition)) return;
  const { input, toolResult, encodeStored } = createMcpToolContext(facade, options);
  server.registerTool(
    "memory_recall",
    {
      description:
        "Recall source-backed memory using required query. Unicode token AND lexical matching, no model. Defaults active/nonretired. Filters precede result limit. maxScan (default 200, max 1000) bounds source scanning; offset continues scanning. limit defaults 5; maxChars defaults 12000 for serialized memories. Returns bounded body/evidence/applicability, checksums, completeness and source continuation. Partial/unverified sources are diagnostic only; guidance is not truth or approval.",
      inputSchema: input.schema(RecallMemorySchema),
      annotations: readOnly,
    },
    (args, ctx) => toolResult(args, () => memoryRecall(facade, args, ctx.mcpReq.signal)),
  );
  server.registerTool(
    "memory_remember",
    {
      description:
        "Store meaningful title/body with optional category (lessons), scope (applicability), labels, status (draft), confidence (low), reviewAfter, evidence and relations. Server supplies id/name/description defaults and dates; never infers approval or evidence. Returns stored record/checksum plus bounded same-title candidates. No automatic merge or target changes. Do not store secrets.",
      inputSchema: input.schema(RememberMemorySchema),
      annotations: write,
    },
    (args, ctx) =>
      toolResult(args, async () => {
        const result = await rememberMemory(facade, args, ctx.mcpReq.signal);
        return {
          ...encodeStored(result.stored),
          id: result.stored.object.id,
          candidates: result.candidates,
          candidateScan: result.candidateScan,
          reconciliation: result.reconciliation,
        };
      }),
  );
  server.registerTool(
    "memory_revise",
    {
      description:
        "Revise one id using expectedChecksum and intentional changes and/or replacement body. Omitted content/evidence/relations survive; relation fields supplied replace only those arrays. Server sets updatedAt. Complete identity-verified source required. No bookkeeping injection, target rewrites, backlinks or inferred approval. Returns stored record and checksum.",
      inputSchema: input.schema(ReviseMemorySchema),
      annotations: write,
    },
    (args, ctx) =>
      toolResult(args, async () => {
        const stored = await reviseMemory(facade, args, ctx.mcpReq.signal);
        return { ...encodeStored(stored), id: stored.object.id };
      }),
  );
  server.registerTool(
    "memory_review",
    {
      description:
        "Read-only maintenance: overdue active entries, declared contradictions, normalized-title duplicate candidates and supersession inconsistencies. asOf defaults to returned server UTC date. maxScan defaults 200 (max 1000); offset continues; limit defaults 50 (max 100); maxEdges defaults 1000. Targets resolve within scanned sources only. Returns actionable references/checksums, limits and completeness. No writes, model calls or truth judgments.",
      inputSchema: input.schema(ReviewMemorySchema),
      annotations: readOnly,
    },
    (args, ctx) => toolResult(args, () => memoryReview(facade, args, ctx.mcpReq.signal)),
  );
}
