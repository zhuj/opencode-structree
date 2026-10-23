import path from "node:path";
import { materializeObjects, validateObjects } from "./lib/materialization/index.ts";
import { coreDefinitions } from "./registry.ts";

export function parseCommandOptions(command: string, args: readonly string[]) {
  let configFile: string | undefined;
  let outputDirectory: string | undefined;
  let check = false;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (option === undefined || seen.has(option)) throw new Error("Duplicate CLI option.");
    seen.add(option);
    if (option === "--check" && command === "materialize") {
      check = true;
      continue;
    }
    if (option !== "--config" && !(option === "--out" && command === "materialize"))
      throw new Error(`Unsupported option: ${option}`);
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`Expected a path after ${option}.`);
    if (option === "--config") configFile = value;
    else outputDirectory = value;
  }
  return { configFile, outputDirectory, check };
}

/** This path deliberately bypasses framework startup, reconciliation, indexes and models. */
export async function runMaterializationCommand(
  command: "validate" | "materialize",
  options: {
    readonly vaultRoot: string;
    readonly outputDirectory?: string;
    readonly check: boolean;
  },
): Promise<number> {
  const projectRoot = process.cwd();
  const validation = { definitions: coreDefinitions, projectRoot, vaultRoot: options.vaultRoot };
  if (command === "validate") {
    const result = await validateObjects(validation);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.valid ? 0 : 2;
  }
  const result = await materializeObjects({
    ...validation,
    outputDirectory: path.resolve(
      projectRoot,
      options.outputDirectory ?? ".local/.structree/materialized",
    ),
    check: options.check,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.valid && result.clean ? 0 : 2;
}
