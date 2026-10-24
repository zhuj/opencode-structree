import path from "node:path";
import { pathToFileURL } from "node:url";
import { diffGraphs } from "./lib/graph-diff/index.ts";
import {
  impactReport,
  lookupByFile,
  renderMermaid,
  traceability,
} from "./lib/graph-tools/index.ts";
import type { MaterializedObject, ObjectRef, RelationKind } from "./lib/model/index.ts";

export const GRAPH_COMMAND_USAGE = `Read-model commands:
  lookup --file <path> --root vault|project [--strict] [--out <dir>]
  impact --of <type:id> [--kinds a,b] [--depth N] [--include-retired=false] [--out <dir>]
  coverage --origin <type> --evidence <type> --kind <kind> [--require-active=false] [--out <dir>]
  diagram [--of <type:id>] [--types a,b] [--kinds a,b] [--title s] [--out <dir>]
  diff --base <dir> --compare <dir> [--ignore-body]`;

type GraphCommand = "lookup" | "impact" | "coverage" | "diagram" | "diff";

export function isGraphCommand(command: string): command is GraphCommand {
  return ["lookup", "impact", "coverage", "diagram", "diff"].includes(command);
}

const commandOptions = {
  lookup: ["--file", "--root", "--strict", "--out"],
  impact: ["--of", "--kinds", "--depth", "--include-retired", "--out"],
  coverage: ["--origin", "--evidence", "--kind", "--require-active", "--out"],
  diagram: ["--of", "--types", "--kinds", "--title", "--out"],
  diff: ["--base", "--compare", "--ignore-body"],
} satisfies Record<GraphCommand, readonly string[]>;

function parseOptions(command: GraphCommand, args: readonly string[]): Map<string, string> {
  const values = new Map<string, string>();
  const allowed: readonly string[] = commandOptions[command];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === undefined) throw new Error("Expected CLI option.");
    const equals = argument.indexOf("=");
    const option = equals < 0 ? argument : argument.slice(0, equals);
    if (!allowed.includes(option)) throw new Error(`Unsupported option: ${option}`);
    if (values.has(option)) throw new Error("Duplicate CLI option.");
    if (option === "--strict" || option === "--ignore-body") {
      if (equals >= 0) throw new Error(`Unsupported option: ${argument}`);
      values.set(option, "true");
      continue;
    }
    const boolean = option === "--include-retired" || option === "--require-active";
    if (equals >= 0 && !boolean) throw new Error(`Unsupported option: ${argument}`);
    const value = equals < 0 ? args[++index] : argument.slice(equals + 1);
    if (!value || value.startsWith("--")) throw new Error(`Expected a value after ${option}.`);
    if (boolean && value !== "true" && value !== "false")
      throw new Error(`Expected true or false after ${option}.`);
    values.set(option, value);
  }
  return values;
}

function required(values: ReadonlyMap<string, string>, option: string): string {
  const value = values.get(option);
  if (value === undefined) throw new Error(`Expected ${option}.\n${GRAPH_COMMAND_USAGE}`);
  return value;
}

function reference(value: string): ObjectRef {
  const parts = value.split(":");
  const [type, id] = parts;
  if (parts.length !== 2 || !type?.trim() || !id?.trim())
    throw new Error("Expected an object reference as <type:id> with nonempty parts.");
  return { type, id };
}

function list(value: string): string[] {
  const items = value.split(",");
  if (items.some((item) => !item.trim()))
    throw new Error("Expected nonempty comma-separated names.");
  return items;
}

function relationKind(value: string): RelationKind {
  switch (value) {
    case "depends":
    case "uses":
    case "justifies":
    case "contains":
    case "owns":
    case "relates":
      return value;
    default:
      throw new Error(`Invalid relation kind: ${value}`);
  }
}

function kinds(values: ReadonlyMap<string, string>): readonly RelationKind[] | undefined {
  const value = values.get("--kinds");
  return value === undefined ? undefined : list(value).map(relationKind);
}

async function loadObjects(directory: string): Promise<readonly MaterializedObject[]> {
  try {
    const graph: { readonly objects?: readonly MaterializedObject[] } = await import(
      pathToFileURL(path.resolve(process.cwd(), directory, "graph.ts")).href
    );
    if (!Array.isArray(graph.objects)) throw new Error("Missing objects export.");
    return graph.objects;
  } catch {
    // Import errors may contain local paths or module contents; report only the caller's directory.
    throw new Error(
      `Unable to load materialized graph from ${JSON.stringify(directory)}. Run bun run materialize first.`,
    );
  }
}

/** Read-model commands deliberately bypass configuration, reconciliation and model startup. */
export async function runGraphCommand(
  command: GraphCommand,
  args: readonly string[],
): Promise<number> {
  const values = parseOptions(command, args);
  const outputDirectory = values.get("--out") ?? ".local/.structree/materialized";
  let output: unknown;
  let code = 0;
  switch (command) {
    case "lookup": {
      const file = required(values, "--file");
      const root = required(values, "--root");
      if (root !== "vault" && root !== "project") throw new Error("Expected --root vault|project.");
      output = {
        matches: lookupByFile(await loadObjects(outputDirectory), file, {
          root,
          strict: values.has("--strict"),
        }),
      };
      break;
    }
    case "impact": {
      const graphRef = reference(required(values, "--of"));
      const depthValue = values.get("--depth");
      const depth = depthValue === undefined ? undefined : Number(depthValue);
      if (depth !== undefined && (!/^\d+$/.test(depthValue ?? "") || !Number.isSafeInteger(depth)))
        throw new Error("Expected --depth to be a nonnegative safe integer.");
      const selectedKinds = kinds(values);
      const options = {
        ...(selectedKinds === undefined ? {} : { kinds: selectedKinds }),
        ...(depth === undefined ? {} : { depth }),
        includeRetired: values.get("--include-retired") !== "false",
      };
      output = { ...impactReport(await loadObjects(outputDirectory), graphRef, options), graphRef };
      break;
    }
    case "coverage": {
      const options = {
        originType: required(values, "--origin"),
        evidenceType: required(values, "--evidence"),
        kind: relationKind(required(values, "--kind")),
        requireActive: values.get("--require-active") === "true",
      };
      output = { rows: traceability(await loadObjects(outputDirectory), options) };
      break;
    }
    case "diagram": {
      const ref = values.get("--of");
      const types = values.get("--types");
      const selectedKinds = kinds(values);
      const title = values.get("--title");
      const options = {
        ...(ref === undefined ? {} : { ref: reference(ref) }),
        ...(types === undefined ? {} : { types: list(types) }),
        ...(selectedKinds === undefined ? {} : { kinds: selectedKinds }),
        ...(title === undefined ? {} : { title }),
      };
      output = { mermaid: renderMermaid(await loadObjects(outputDirectory), options) };
      break;
    }
    case "diff": {
      const basePath = required(values, "--base");
      const comparePath = required(values, "--compare");
      const [previous, current] = await Promise.all([
        loadObjects(basePath),
        loadObjects(comparePath),
      ]);
      const result = diffGraphs(previous, current, { ignoreBody: values.has("--ignore-body") });
      output = { ...result, basePath, comparePath };
      code = result.equal ? 0 : 2;
      break;
    }
    default: {
      const exhaustive: never = command;
      throw new Error(`Unknown graph command: ${exhaustive}`);
    }
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  return code;
}
