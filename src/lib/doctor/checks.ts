import type { ObjectDefinition } from "../types.ts";
import type { DoctorProbe, DoctorProbeId, ProbeExecution } from "./types.ts";

export interface DoctorCheckOptions {
  /** Trusted host-selected schemas; schema-dependent checks block when absent or empty. */
  readonly definitions?: readonly ObjectDefinition[];
  readonly sourceRoot: string;
  readonly projectRoot: string;
  readonly configFile?: string;
  readonly cacheFile?: string;
  readonly materializedDirectory?: string;
}

function unavailable(id: DoctorProbeId): ProbeExecution {
  const details: Readonly<Record<DoctorProbeId, string>> = {
    root: "The selected root probe is unavailable.",
    inventory: "The selected inventory probe is unavailable.",
    config: "The selected configuration check is unavailable.",
    "source-validation": "The selected source validation check is unavailable.",
    cache: "The selected cache check is unavailable.",
    materialization: "The selected materialization check is unavailable.",
  };
  return {
    status: "blocked",
    coverage: "unknown",
    findings: [
      {
        code: "PROBE_UNAVAILABLE",
        severity: "warning",
        capability: id,
        message: details[id],
        actions: ["retry-diagnosis"],
      },
    ],
  };
}

export function createDoctorProbes(options: DoctorCheckOptions): readonly DoctorProbe[] {
  const selected: DoctorCheckOptions = {
    ...(options.definitions === undefined
      ? {}
      : { definitions: Object.freeze([...options.definitions]) }),
    projectRoot: options.projectRoot,
    sourceRoot: options.sourceRoot,
    ...(options.configFile ? { configFile: options.configFile } : {}),
    ...(options.cacheFile ? { cacheFile: options.cacheFile } : {}),
    ...(options.materializedDirectory
      ? { materializedDirectory: options.materializedDirectory }
      : {}),
  };
  return [
    {
      id: "config",
      run: async ({ signal }) => {
        let check: typeof import("./config-check.ts");
        try {
          check = await import("./config-check.ts");
        } catch {
          return unavailable("config");
        }
        return check.runConfigCheck(selected, signal);
      },
    },
    {
      id: "source-validation",
      run: async ({ signal }) => {
        let check: typeof import("./source-check.ts");
        try {
          check = await import("./source-check.ts");
        } catch {
          return unavailable("source-validation");
        }
        return check.runSourceCheck(selected, signal);
      },
    },
    {
      id: "cache",
      run: async ({ signal }) => {
        let check: typeof import("./cache-check.ts");
        try {
          check = await import("./cache-check.ts");
        } catch {
          return unavailable("cache");
        }
        return check.runCacheCheck(selected, signal);
      },
    },
    {
      id: "materialization",
      run: async ({ signal }) => {
        let check: typeof import("./materialization-check.ts");
        try {
          check = await import("./materialization-check.ts");
        } catch {
          return unavailable("materialization");
        }
        return check.runMaterializationCheck(selected, signal);
      },
    },
  ];
}
