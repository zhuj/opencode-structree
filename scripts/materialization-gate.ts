import path from "node:path";
import { loadConfig, loadDefaultConfig } from "../src/lib/config.ts";
import { materializeObjects, validateObjects } from "../src/lib/materialization/index.ts";
import { coreDefinitions } from "../src/registry.ts";

/**
 * CI gate: strict no-partial validation plus a non-writing drift check of the
 * default (or explicit) materialized output. Markdown stays authoritative.
 */

interface GateOptions {
  readonly configFile: string | undefined;
  readonly outputDirectory: string | undefined;
}

function parseGateOptions(args: readonly string[]): GateOptions {
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

/** exit 0 strict-clean, 2 gate failure, 1 unexpected/usage error (caller-selected exit). */
export async function runGateOptions(options: GateOptions): Promise<number> {
  try {
    const projectRoot = process.cwd();
    const config =
      options.configFile === undefined
        ? await loadDefaultConfig()
        : await loadConfig(options.configFile);
    const common = { definitions: coreDefinitions, projectRoot, vaultRoot: config.root };
    const validation = await validateObjects(common);
    // Strict policy: partial recoverable documents are not errors, but never pass the gate.
    const strict = validation.valid && validation.partialObjects.length === 0;
    const checked = strict
      ? await materializeObjects({
          ...common,
          outputDirectory: path.resolve(
            projectRoot,
            options.outputDirectory ?? ".local/.structree/materialized",
          ),
          check: true,
        })
      : null;
    process.stdout.write(
      `${JSON.stringify(
        {
          valid: validation.valid,
          partial: validation.partialObjects.length,
          counts: validation.counts,
          diagnostics: validation.diagnostics.filter((d) => d.severity === "error"),
          check:
            checked === null
              ? null
              : {
                  clean: checked.clean,
                  drift: checked.drift,
                  diagnostics: checked.diagnostics.filter((d) => d.severity === "error"),
                },
        },
        null,
        2,
      )}\n`,
    );
    if (!strict) return 2;
    return checked ? (checked.clean ? 0 : 2) : 2;
  } catch (error) {
    process.stderr.write(`[gate] ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

process.exit(await runGateOptions(parseGateOptions(process.argv.slice(2))));
