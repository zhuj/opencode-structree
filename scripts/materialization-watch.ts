import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { loadConfig, loadDefaultConfig } from "../src/lib/config.ts";
import { materializeObjects, validateObjects } from "../src/lib/materialization/index.ts";
import { coreDefinitions } from "../src/registry.ts";

/**
 * Developer watcher: regenerate the derived read model whenever authoritative
 * Markdown changes. Publishing happens only for strictly valid vaults; invalid
 * sources only report diagnostics, and the previous good output is kept.
 */

const DEFAULT_OUTPUT = ".local/.structree/materialized";
const DEBOUNCE_MS = 500;

interface WatchOptions {
  readonly configFile: string | undefined;
  readonly outputDirectory: string | undefined;
}

function parseWatchOptions(args: readonly string[]): WatchOptions {
  let configFile: string | undefined;
  let outputDirectory: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (option !== "--config" && option !== "--out")
      throw new Error(`Unsupported option: ${option ?? "(missing argument)"}`);
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`Expected a path after ${option}.`);
    if (option === "--config") configFile = value;
    else outputDirectory = value;
  }
  return { configFile, outputDirectory };
}

function report(payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function runCycle(
  event: string,
  options: {
    readonly definitions: typeof coreDefinitions;
    readonly projectRoot: string;
    readonly vaultRoot: string;
    readonly outputDirectory: string;
  },
): Promise<void> {
  const validation = await validateObjects(options);
  if (!validation.valid || validation.partialObjects.length > 0) {
    report({
      event,
      published: false,
      valid: validation.valid,
      partial: validation.partialObjects.length,
      diagnostics: validation.diagnostics.filter((d) => d.severity === "error"),
    });
    return;
  }
  try {
    const result = await materializeObjects({ ...options, check: false });
    report({
      event,
      published: result.published,
      clean: result.clean,
      valid: result.valid,
      counts: result.counts,
      drift: result.drift,
      diagnostics: result.diagnostics.filter((d) => d.severity === "error"),
    });
  } catch (error) {
    report({
      event,
      published: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function runWatch(options: WatchOptions): Promise<void> {
  const projectRoot = process.cwd();
  const config =
    options.configFile === undefined
      ? await loadDefaultConfig()
      : await loadConfig(options.configFile);
  const cycleOptions = {
    definitions: coreDefinitions,
    projectRoot,
    vaultRoot: config.root,
    outputDirectory: path.resolve(projectRoot, options.outputDirectory ?? DEFAULT_OUTPUT),
  };
  let pending: ReturnType<typeof setTimeout> | undefined;
  let running = Promise.resolve();
  const schedule = (event: string): void => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = undefined;
      running = running
        .then(() => runCycle(event, cycleOptions))
        .catch((error: unknown) => {
          report({ event, error: error instanceof Error ? error.message : String(error) });
        });
    }, DEBOUNCE_MS);
  };
  const watcher: FSWatcher = chokidar.watch(config.root, {
    ignoreInitial: true,
    ignored: (candidatePath) => !candidatePath.endsWith(".md"),
  });
  for (const event of ["add", "change", "unlink"] as const)
    watcher.on(event, (candidatePath: string) => {
      report({ event, changed: candidatePath });
      schedule(event);
    });
  process.stderr.write(
    `[watch] watching ${config.root}; output ${cycleOptions.outputDirectory}; Ctrl+C stops\n`,
  );
  await runCycle("startup", cycleOptions);
  const stop = (): void => {
    void watcher.close().then(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

void runWatch(parseWatchOptions(process.argv.slice(2))).catch((error: unknown) => {
  process.stderr.write(`[watch] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
