import { McpServer } from "@modelcontextprotocol/server";
import {
  type McpToolOptions,
  registerObjectTools as registerLibraryObjectTools,
} from "./lib/mcp.ts";
import type { ObjectFacade } from "./lib/types.ts";
import { registerMemoryTools } from "./memory/mcp.ts";
import { registerStructreeTools } from "./structree/mcp.ts";

export { effectMcpSchema, type McpToolOptions } from "./lib/mcp.ts";

/** Application composition adds domain tools without changing the reusable library adapter. */
export function registerObjectTools(
  server: McpServer,
  facade: ObjectFacade,
  options: McpToolOptions = {},
): void {
  registerStructreeTools(server, facade, options);
  registerMemoryTools(server, facade, options);
  registerLibraryObjectTools(server, facade, options);
}

/** The host owns the facade lifetime, as with the library server. */
export function createMcpServer(
  facade: ObjectFacade,
  info: { name: string; version: string } = { name: "object-mcp", version: "0.1.0" },
  options: McpToolOptions = {},
): McpServer {
  const server = new McpServer(info);
  registerObjectTools(server, facade, options);
  return server;
}
