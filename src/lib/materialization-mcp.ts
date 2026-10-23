import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { Schema } from "effect";
import {
  type MaterializationResult,
  materializeObjects,
  type ValidationOptions,
  type ValidationResult,
  validateObjects,
} from "./materialization/index.ts";
import { effectMcpSchema } from "./mcp-input.ts";

export interface MaterializationToolOptions extends Omit<ValidationOptions, "signal"> {
  readonly outputDirectory: string;
}

async function toolResult(
  operation: () => Promise<ValidationResult | MaterializationResult>,
): Promise<CallToolResult> {
  // no-excuse-ok: catch -- MCP boundary exposes no unexpected exception details.
  try {
    const result = await operation();
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: { ...result },
      isError: !result.valid || ("clean" in result && !result.clean),
    };
  } catch {
    const result = {
      valid: false,
      diagnostics: [{ code: "INTERNAL", severity: "error", message: "Tool execution failed." }],
    };
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
      isError: true,
    };
  }
}

/** Optional tools: only the host selects sources, definitions and the fixed write destination. */
export function registerMaterializationTools(
  server: McpServer,
  options: MaterializationToolOptions,
): void {
  const { definitions, projectRoot, vaultRoot, outputDirectory } = options;
  const validation = { definitions, projectRoot, vaultRoot };
  server.registerTool(
    "objects_validate",
    {
      description:
        "Validate source objects without modifying sources, caches or generated outputs.",
      inputSchema: effectMcpSchema(Schema.Record(Schema.String, Schema.Never)),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (_args, ctx) => toolResult(() => validateObjects({ ...validation, signal: ctx.mcpReq.signal })),
  );
  server.registerTool(
    "objects_materialize",
    {
      description:
        "Generate data-only artifacts in the host-configured directory. check reports drift without writes; clean:false is an error result. Never executes generated code or modifies sources.",
      inputSchema: effectMcpSchema(Schema.Struct({ check: Schema.optionalKey(Schema.Boolean) })),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args, ctx) =>
      toolResult(() =>
        materializeObjects({
          ...validation,
          outputDirectory,
          ...(args.check === undefined ? {} : { check: args.check }),
          signal: ctx.mcpReq.signal,
        }),
      ),
  );
}
