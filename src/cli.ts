#!/usr/bin/env bun
import { StdioServerTransport, serveStdio } from "@modelcontextprotocol/server/stdio";
import { createFramework } from "./framework.ts";
import { loadConfig, loadDefaultConfig } from "./lib/config.ts";
import { parseCommandOptions, runMaterializationCommand } from "./materialization-cli.ts";
import { createMaterializationServer } from "./materialization-server.ts";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? "serve";
  if (["--help", "-h", "help"].includes(command)) {
    process.stdout.write(
      "Usage: bun src/cli.ts <serve|sync|status> [--config <file>]\n       bun src/cli.ts <validate|materialize> [--config <file>] [--check] [--out <path>]\n\nserve: MCP over stdio\nsync: reconcile files, report errors, exit\nstatus: startup reconciliation and current index status\nvalidate: read-only source validation\nmaterialize: generate data-only artifacts [--check] [--out <path>]\n\nWithout --config the built-in defaults apply. The optional .local/.structree/config.yaml is read from the working directory when it exists. Materialized output defaults to .local/.structree/materialized under the working directory. --check reports drift without writing.\n",
    );
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
  const framework = await createFramework({
    waitForStartup: command !== "serve",
    config: {
      ...config,
      sync: { ...config.sync, watch: command === "serve" && config.sync.watch },
    },
    onError: (error) => process.stderr.write(`[object-mcp] ${error.code}: ${error.message}\n`),
  });
  if (command === "serve" || command === "sync") {
    try {
      await framework.prepareEmbeddings();
    } catch {
      // The framework already reported the failure; the full-text path still works without the model.
    }
  }
  if (command !== "serve") {
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
  const transport = new StdioServerTransport();
  const closeTransport = transport.close.bind(transport);
  transport.close = async () => {
    try {
      await closeTransport();
    } finally {
      await framework.close();
    }
  };
  const handle = serveStdio(() => createMaterializationServer(framework, config), {
    transport,
    onerror: (error) => process.stderr.write(`[mcp] ${error.message}\n`),
  });
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (): Promise<void> =>
    (shutdownPromise ??= (async () => {
      await handle.close();
      await framework.close();
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
