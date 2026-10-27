import path from "node:path";
import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { Schema } from "effect";
import type { DoctorCheckOptions } from "./doctor/checks.ts";
import type { DoctorProbe } from "./doctor/index.ts";
import { DOCTOR_PROBES, runDoctorReport } from "./doctor/index.ts";
import { effectMcpSchema } from "./mcp-input.ts";

export interface DoctorToolHostOptions
  extends Omit<DoctorCheckOptions, "sourceRoot" | "projectRoot"> {
  readonly root: string;
  readonly projectRoot: string;
}

const ProbeId = Schema.Literals(DOCTOR_PROBES);
const Input = Schema.Struct({
  checks: Schema.optionalKey(Schema.Array(ProbeId)),
  budgetMs: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 30_000 }))),
  maxEntries: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000 })),
  ),
  maxDirectories: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  ),
});
const Context = Schema.Record(Schema.String, Schema.Number);
const Summary = Schema.Union([
  Schema.Struct({
    id: ProbeId,
    status: Schema.Literal("ok"),
    coverage: Schema.Literals(["complete", "limited", "unknown", "not-applicable"]),
    context: Context,
  }),
  Schema.Struct({
    id: ProbeId,
    status: Schema.Literal("findings"),
    coverage: Schema.Literals(["complete", "limited", "unknown", "not-applicable"]),
    context: Context,
  }),
  Schema.Struct({
    id: ProbeId,
    status: Schema.Literal("blocked"),
    coverage: Schema.Literal("unknown"),
    context: Context,
  }),
  Schema.Struct({
    id: ProbeId,
    status: Schema.Literal("failed"),
    coverage: Schema.Literal("unknown"),
    context: Context,
  }),
  Schema.Struct({
    id: ProbeId,
    status: Schema.Literal("not-checked"),
    coverage: Schema.Literal("not-applicable"),
    context: Context,
  }),
]);
const Finding = Schema.Struct({
  code: Schema.String,
  severity: Schema.Literals(["warning", "error"]),
  capability: ProbeId,
  path: Schema.optionalKey(Schema.String),
  message: Schema.String,
  actions: Schema.optionalKey(
    Schema.Array(
      Schema.Literals(["inspect-source", "inspect-config", "inspect-cache", "retry-diagnosis"]),
    ),
  ),
});
const Output = Schema.Struct({
  version: Schema.Literal(1),
  status: Schema.Literals(["complete", "incomplete"]),
  requestedProbes: Schema.Array(ProbeId),
  probes: Schema.Array(Summary),
  findings: Schema.Array(Finding),
});

type ProbeLoader = (options: DoctorCheckOptions) => Promise<readonly DoctorProbe[]>;

const loadBuiltinProbes: ProbeLoader = async (options) =>
  (await import("./doctor/checks.ts")).createDoctorProbes(options);

function isBuiltinProbeId(id: (typeof DOCTOR_PROBES)[number]): id is DoctorProbe["id"] {
  return id !== "root" && id !== "inventory";
}

function unavailableProbe(id: DoctorProbe["id"]): DoctorProbe {
  return {
    id,
    run: async () => ({
      status: "blocked",
      coverage: "unknown",
      findings: [
        {
          code: "PROBE_UNAVAILABLE",
          severity: "warning",
          capability: id,
          message: "The requested diagnostic probe is unavailable.",
          actions: ["retry-diagnosis"],
        },
      ],
    }),
  };
}

async function selectedProbes(
  selected: readonly (typeof DOCTOR_PROBES)[number][],
  options: DoctorCheckOptions,
  load: ProbeLoader,
): Promise<readonly DoctorProbe[]> {
  const requested = [...new Set(selected.filter(isBuiltinProbeId))];
  if (requested.length === 0) return [];
  try {
    const available = await load(options);
    return requested.map(
      (id) => available.find((probe) => probe.id === id) ?? unavailableProbe(id),
    );
  } catch {
    return requested.map(unavailableProbe);
  }
}

export function registerDoctorTools(
  server: McpServer,
  host: DoctorToolHostOptions,
  load: ProbeLoader = loadBuiltinProbes,
): void {
  const paths: DoctorCheckOptions = {
    ...(host.definitions === undefined
      ? {}
      : { definitions: Object.freeze([...host.definitions]) }),
    sourceRoot: path.resolve(host.root),
    projectRoot: path.resolve(host.projectRoot),
    ...(host.configFile === undefined ? {} : { configFile: path.resolve(host.configFile) }),
    ...(host.cacheFile === undefined ? {} : { cacheFile: path.resolve(host.cacheFile) }),
    ...(host.materializedDirectory === undefined
      ? {}
      : { materializedDirectory: path.resolve(host.materializedDirectory) }),
  };
  server.registerTool(
    "objects_doctor",
    {
      description: "Run bounded read-only diagnostics using host-owned paths.",
      inputSchema: effectMcpSchema(Input),
      outputSchema: effectMcpSchema(Output),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, ctx): Promise<CallToolResult> => {
      try {
        const checks = args.checks ?? ["root", "inventory"];
        const builtins = await selectedProbes(checks, paths, load);
        const report = await runDoctorReport({
          root: paths.sourceRoot,
          probes: checks,
          builtinProbes: builtins,
          signal: ctx.mcpReq.signal,
          ...(args.budgetMs === undefined ? {} : { budgetMs: args.budgetMs }),
          limits: {
            ...(args.maxEntries === undefined ? {} : { maxEntries: args.maxEntries }),
            ...(args.maxDirectories === undefined ? {} : { maxDirectories: args.maxDirectories }),
          },
        });
        return {
          content: [{ type: "text", text: JSON.stringify(report) }],
          structuredContent: report,
        };
      } catch {
        return {
          content: [{ type: "text", text: '{"error":"Doctor request could not be completed."}' }],
          isError: true,
        };
      }
    },
  );
}
