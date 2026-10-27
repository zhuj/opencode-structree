import type { RecoveryRoot } from "../recovery/index.ts";

export const DOCTOR_PROBES = [
  "root",
  "inventory",
  "config",
  "source-validation",
  "cache",
  "materialization",
] as const;

export type DoctorProbeId = (typeof DOCTOR_PROBES)[number];
export type ProbeStatus = "ok" | "findings" | "blocked" | "failed" | "not-checked";
export type ProbeCoverage = "complete" | "limited" | "unknown" | "not-applicable";
export type FindingSeverity = "warning" | "error";
export type FindingActionId =
  | "inspect-source"
  | "inspect-config"
  | "inspect-cache"
  | "retry-diagnosis";

export type DoctorFinding = {
  readonly code: string;
  readonly severity: FindingSeverity;
  readonly capability: DoctorProbeId;
  readonly path?: string;
  readonly message: string;
  readonly actions?: readonly FindingActionId[];
};

export type ProbeSummary =
  | {
      readonly id: DoctorProbeId;
      readonly status: "ok";
      readonly coverage: ProbeCoverage;
      readonly context: Readonly<Record<string, number>>;
    }
  | {
      readonly id: DoctorProbeId;
      readonly status: "findings";
      readonly coverage: ProbeCoverage;
      readonly context: Readonly<Record<string, number>>;
    }
  | {
      readonly id: DoctorProbeId;
      readonly status: "blocked";
      readonly coverage: "unknown";
      readonly context: Readonly<Record<string, number>>;
    }
  | {
      readonly id: DoctorProbeId;
      readonly status: "failed";
      readonly coverage: "unknown";
      readonly context: Readonly<Record<string, number>>;
    }
  | {
      readonly id: DoctorProbeId;
      readonly status: "not-checked";
      readonly coverage: "not-applicable";
      readonly context: Readonly<Record<string, number>>;
    };

export type DoctorReport = {
  readonly version: 1;
  readonly status: "complete" | "incomplete";
  readonly requestedProbes: readonly DoctorProbeId[];
  readonly probes: readonly ProbeSummary[];
  readonly findings: readonly DoctorFinding[];
};

export type ProbeExecution = {
  readonly status: "ok" | "findings" | "blocked" | "failed";
  readonly coverage: ProbeCoverage;
  readonly context?: Readonly<Record<string, number>>;
  readonly findings?: readonly DoctorFinding[];
};

export type DoctorProbe = {
  /** Trusted compile-time built-in only; return fixed prose and safe relative paths, never file data. */
  readonly id: Exclude<DoctorProbeId, "root" | "inventory">;
  readonly run: (context: {
    readonly root?: RecoveryRoot;
    readonly signal?: AbortSignal;
  }) => Promise<ProbeExecution>;
};

export type DoctorOptions = {
  readonly root: string;
  readonly probes?: readonly DoctorProbeId[];
  /** Trusted compile-time built-ins only; never populate from runtime plugin or user input. */
  readonly builtinProbes?: readonly DoctorProbe[];
  readonly signal?: AbortSignal;
  readonly budgetMs?: number;
  readonly limits?: { readonly maxEntries?: number; readonly maxDirectories?: number };
};
