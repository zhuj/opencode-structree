import path from "node:path";
import { registerDoctorTools } from "./lib/doctor-mcp.ts";
import { registerMaterializationTools } from "./lib/materialization-mcp.ts";
import { createMcpServer } from "./lib/mcp.ts";
import { createSourceRepairSession } from "./lib/source-repair/index.ts";
import { registerSourceRepairToolsWithSessionFactory } from "./lib/source-repair-mcp.ts";
import type { FrameworkConfig, ObjectFacade } from "./lib/types.ts";

/** Keep the library's existing server opt-in; only CLI serve installs these tools by default. */
export function createMaterializationServer(
  facade: ObjectFacade,
  config: FrameworkConfig,
  createRepairSession: typeof createSourceRepairSession = createSourceRepairSession,
) {
  const server = createMcpServer(facade, config.server, config.mcp);
  registerMaterializationTools(server, {
    definitions: facade.definitions,
    projectRoot: process.cwd(),
    vaultRoot: config.root,
    outputDirectory: path.resolve(".local/.structree/materialized"),
  });
  registerDoctorTools(server, {
    definitions: facade.definitions,
    root: config.root,
    projectRoot: process.cwd(),
    cacheFile: config.sqlite.path,
    materializedDirectory: path.resolve(".local/.structree/materialized"),
  });
  registerSourceRepairToolsWithSessionFactory(
    server,
    {
      root: config.root,
      driver: config.sqlite.driver,
      confinement: config.sync.confinement,
      maxBytes: Math.min(config.sync.maxFileBytes, 5_000_000),
      lockTimeoutMs: config.sync.lockTimeoutMs,
    },
    createRepairSession,
  );
  return server;
}
