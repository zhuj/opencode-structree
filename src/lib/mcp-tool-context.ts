import type { CallToolResult } from "@modelcontextprotocol/server";
import { Schema } from "effect";
import { defaultConfig, McpInputRepairConfigSchema } from "./config.ts";
import { FrameworkError } from "./errors.ts";
import { createMcpInputBoundary } from "./mcp-input.ts";
import { ObjectRegistry } from "./registry.ts";
import type { McpInputRepairConfig, ObjectFacade, ReadObject } from "./types.ts";

export interface McpToolOptions {
  readonly inputRepair?: Partial<McpInputRepairConfig>;
}

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

/** Shared input repair, error translation and object encoding for tools over a registered facade. */
export function createMcpToolContext(
  facade: Pick<ObjectFacade, "definitions" | "config">,
  options: McpToolOptions = {},
) {
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
  return { registry, input, toolResult, encodeStored };
}
