import path from "node:path";
import { registerMaterializationTools } from "./lib/materialization-mcp.ts";
import { createMcpServer } from "./lib/mcp.ts";
import type { FrameworkConfig, ObjectFacade } from "./lib/types.ts";

/** Keep the library's existing server opt-in; only CLI serve installs these tools by default. */
export function createMaterializationServer(facade: ObjectFacade, config: FrameworkConfig) {
  const server = createMcpServer(facade, config.server, config.mcp);
  registerMaterializationTools(server, {
    definitions: facade.definitions,
    projectRoot: process.cwd(),
    vaultRoot: config.root,
    outputDirectory: path.resolve(".local/.structree/materialized"),
  });
  return server;
}
