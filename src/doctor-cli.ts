import path from "node:path";
import { parseArgs } from "node:util";
import type { DoctorCheckOptions } from "./lib/doctor/checks.ts";
import type { DoctorProbe, DoctorProbeId } from "./lib/doctor/index.ts";
import { DOCTOR_PROBES, doctorExitCode, runDoctorReport } from "./lib/doctor/index.ts";

type Options = {
  readonly root: string;
  readonly checks: readonly DoctorProbeId[];
  readonly config?: string;
  readonly cache?: string;
  readonly output?: string;
  readonly budgetMs?: number;
};

type ProbeLoader = (options: DoctorCheckOptions) => Promise<readonly DoctorProbe[]>;

const loadBuiltinProbes: ProbeLoader = async (options) =>
  (await import("./lib/doctor/checks.ts")).createDoctorProbes(options);

function isBuiltinProbeId(id: DoctorProbeId): id is DoctorProbe["id"] {
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

export async function buildDoctorCliProbes(
  selected: readonly DoctorProbeId[],
  options: DoctorCheckOptions,
  load: ProbeLoader = loadBuiltinProbes,
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

function parse(args: readonly string[]): Options {
  const { values } = parseArgs({
    args: [...args],
    strict: true,
    allowPositionals: false,
    options: {
      root: { type: "string" },
      checks: { type: "string" },
      config: { type: "string" },
      cache: { type: "string" },
      out: { type: "string" },
      "budget-ms": { type: "string" },
    },
  });
  if (!values.root) throw new TypeError("An explicit --root is required.");
  const selected: DoctorProbeId[] = [];
  for (const check of values.checks === undefined
    ? ["root", "inventory"]
    : values.checks.split(",")) {
    const known = DOCTOR_PROBES.find((candidate) => candidate === check);
    if (known === undefined) throw new TypeError("Unknown doctor check.");
    selected.push(known);
  }
  const budgetMs = values["budget-ms"] === undefined ? undefined : Number(values["budget-ms"]);
  if (
    budgetMs !== undefined &&
    (!/^\d+$/.test(values["budget-ms"] ?? "") || budgetMs < 1 || budgetMs > 30_000)
  )
    throw new TypeError("Invalid doctor budget.");
  return {
    root: values.root,
    checks: selected,
    ...(values.config === undefined ? {} : { config: values.config }),
    ...(values.cache === undefined ? {} : { cache: values.cache }),
    ...(values.out === undefined ? {} : { output: values.out }),
    ...(budgetMs === undefined ? {} : { budgetMs }),
  };
}

export async function runDoctorCli(args: readonly string[]): Promise<number> {
  try {
    const options = parse(args);
    let definitions: DoctorCheckOptions["definitions"];
    if (options.checks.some((id) => id === "source-validation" || id === "materialization")) {
      try {
        definitions = (await import("./registry.ts")).coreDefinitions;
      } catch {
        // Schema-dependent probes block without disabling unrelated optional checks.
      }
    }
    const builtinProbes = await buildDoctorCliProbes(options.checks, {
      ...(definitions === undefined ? {} : { definitions }),
      sourceRoot: path.resolve(options.root),
      projectRoot: process.cwd(),
      ...(options.config === undefined ? {} : { configFile: path.resolve(options.config) }),
      ...(options.cache === undefined ? {} : { cacheFile: path.resolve(options.cache) }),
      ...(options.output === undefined
        ? {}
        : { materializedDirectory: path.resolve(options.output) }),
    });
    const report = await runDoctorReport({
      root: path.resolve(options.root),
      probes: options.checks,
      builtinProbes,
      ...(options.budgetMs === undefined ? {} : { budgetMs: options.budgetMs }),
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return doctorExitCode(report);
  } catch {
    process.stdout.write(
      `${JSON.stringify({ version: 1, status: "failed", error: "Invalid doctor request." })}\n`,
    );
    return 1;
  }
}
