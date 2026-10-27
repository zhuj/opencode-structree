#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { StdioServerTransport, serveStdio } from "@modelcontextprotocol/server/stdio";
import { GRAPH_COMMAND_USAGE, isGraphCommand, runGraphCommand } from "./graph-tools-cli.ts";
import {
  defaultConfig,
  LOCAL_STATE_RELATIVE_DIRECTORY,
  loadConfig,
  loadDefaultConfig,
} from "./lib/config.ts";
import { createResilientRuntime } from "./lib/resilient-runtime.ts";
import { parseCommandOptions, runMaterializationCommand } from "./materialization-cli.ts";
import { createMaterializationServer } from "./materialization-server.ts";
import { coreDefinitions } from "./registry.ts";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? "serve";
  if (command === "doctor") {
    const { runDoctorCli } = await import("./doctor-cli.ts");
    process.exitCode = await runDoctorCli(args.slice(1));
    return;
  }
  if (command === "repair") {
    const { runRepairCli } = await import("./repair-cli.ts");
    process.exitCode = await runRepairCli(args.slice(1));
    return;
  }
  if (["--help", "-h", "help"].includes(command)) {
    process.stdout.write(
      "Usage: bun src/cli.ts <serve|sync|status> [--config <file>]\n       bun src/cli.ts <validate|materialize> [--config <file>] [--check] [--out <path>]\n\nserve: MCP over stdio (creates local state and the default objects root; custom roots must exist)\nsync: reconcile files, report errors, exit\nstatus: startup reconciliation and current index status\nvalidate: read-only source validation\nmaterialize: generate data-only artifacts [--check] [--out <path>]\n\nWithout --config the built-in defaults apply. The optional .local/.structree/config.yaml is read from the working directory when it exists. Materialized output defaults to .local/.structree/materialized under the working directory. --check reports drift without writing. If config or registry cannot be loaded, use bun src/recovery-cli.ts with an explicit existing root for independent read/list access.\n",
    );
    process.stdout.write(`${GRAPH_COMMAND_USAGE}\n`);
    return;
  }
  if (isGraphCommand(command)) {
    process.exitCode = await runGraphCommand(command, args.slice(1));
    return;
  }
  if (!["serve", "sync", "status", "validate", "materialize"].includes(command))
    throw new Error(`Unknown command: ${command}`);
  const tail = args.slice(1);
  const isMaterialization = command === "validate" || command === "materialize";
  if (
    !isMaterialization &&
    tail.length &&
    (tail.length !== 2 || tail[0] !== "--config" || !tail[1])
  )
    throw new Error("Expected --config <filename>.");
  const options = isMaterialization
    ? parseCommandOptions(command, tail)
    : { configFile: tail[1], outputDirectory: undefined, check: false };
  if (command === "serve") {
    await mkdir(path.resolve(process.cwd(), LOCAL_STATE_RELATIVE_DIRECTORY), { recursive: true });
  }
  const config =
    options.configFile === undefined
      ? await loadDefaultConfig()
      : await loadConfig(options.configFile);
  if (command === "validate" || command === "materialize") {
    process.exitCode = await runMaterializationCommand(command, {
      vaultRoot: config.root,
      ...(options.outputDirectory === undefined
        ? {}
        : { outputDirectory: options.outputDirectory }),
      check: options.check,
    });
    return;
  }
  if (command !== "serve") {
    const { createFramework } = await import("./framework.ts");
    const framework = await createFramework({
      waitForStartup: true,
      config: { ...config, sync: { ...config.sync, watch: false } },
      onError: (error) => process.stderr.write(`[object-mcp] ${error.code}: ${error.message}\n`),
    });
    if (command === "sync") {
      try {
        await framework.prepareEmbeddings();
      } catch {
        // The framework already reported the failure; the full-text path still works without the model.
      }
    }
    try {
      const output = command === "sync" ? framework.status().lastSync : framework.status();
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
      const lastSync = framework.status().lastSync as { issues?: unknown[] } | null;
      if (lastSync?.issues?.length) process.exitCode = 2;
    } finally {
      await framework.close();
    }
    return;
  }
  if (config.root === path.resolve(process.cwd(), defaultConfig.root)) {
    await mkdir(config.root, { recursive: true });
  }
  const runtime = await createResilientRuntime({
    config,
    definitions: coreDefinitions,
  });
  const transport = new StdioServerTransport();
  const closeTransport = transport.close.bind(transport);
  transport.close = async () => {
    try {
      await closeTransport();
    } finally {
      await runtime.close();
    }
  };
  const handle = serveStdio(() => createMaterializationServer(runtime, config), {
    transport,
    onerror: (error) => process.stderr.write(`[mcp] ${error.message}\n`),
  });
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (): Promise<void> =>
    (shutdownPromise ??= (async () => {
      await handle.close();
      await runtime.close();
    })());
  const stop = () => {
    void shutdown().catch((error) => {
      process.stderr.write(`${String(error)}\n`);
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.stdin.once("end", stop);
  process.stdin.once("close", stop);
}

void main().catch((error) => {
  process.stderr.write(`[object-mcp] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
