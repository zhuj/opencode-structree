import { materializeObjects } from "../materialization/index.ts";
import type { DoctorCheckOptions } from "./checks.ts";
import type { DoctorFinding, FindingSeverity, ProbeExecution } from "./types.ts";

const finding = (
  code: string,
  message: string,
  severity: FindingSeverity = "warning",
): DoctorFinding => ({
  capability: "materialization",
  code,
  severity,
  message,
  actions: ["inspect-source"],
});
const blocked = (): ProbeExecution => ({
  status: "blocked",
  coverage: "unknown",
  findings: [
    {
      capability: "materialization",
      code: "MATERIALIZATION_UNAVAILABLE",
      severity: "warning",
      message: "The selected materialization directory could not be checked.",
      actions: ["retry-diagnosis"],
    },
  ],
});

export async function runMaterializationCheck(
  options: DoctorCheckOptions,
  signal?: AbortSignal,
): Promise<ProbeExecution> {
  if (!options.materializedDirectory || !options.definitions?.length) return blocked();
  try {
    signal?.throwIfAborted();
    const result = await materializeObjects({
      definitions: options.definitions,
      projectRoot: options.projectRoot,
      vaultRoot: options.sourceRoot,
      outputDirectory: options.materializedDirectory,
      check: true,
      inspectionLimits: { maxEntries: 1000, maxFileBytes: 1_048_576, maxTotalBytes: 8_388_608 },
      ...(signal ? { signal } : {}),
    });
    const context = {
      scanned: result.counts.scanned,
      outputs: result.manifest?.outputs.length ?? 0,
      drift: result.drift.length,
      errors: result.counts.errors,
    };
    const unobserved = result.diagnostics.some((item) =>
      ["SOURCE_READ", "SOURCE_PATH", "UNKNOWN_SOURCE_TYPE", "FILE_BINDING"].includes(item.code),
    );
    if (
      result.diagnostics.some((item) =>
        ["VALIDATION_SETUP", "ABORTED", "MATERIALIZATION", "OUTPUT_CHANGED"].includes(item.code),
      )
    )
      return blocked();
    if (result.diagnostics.some((item) => item.code === "OUTPUT_INSPECTION_BUDGET"))
      return blocked();
    const outputErrors = result.diagnostics.some((item) =>
      ["OUTPUT_CONFLICT", "OBSOLETE_OUTPUT"].includes(item.code),
    );
    if (outputErrors)
      return {
        status: "findings",
        coverage: "limited",
        context,
        findings: [
          finding(
            "MATERIALIZATION_OUTPUT_CONFLICT",
            "The selected output directory contains conflicting or unowned materialized state.",
            "error",
          ),
        ],
      };
    if (unobserved || result.counts.partial > 0)
      return {
        status: "findings",
        coverage: "limited",
        context,
        findings: [
          finding(
            "MATERIALIZATION_INPUT_INCOMPLETE",
            "Source validation prevented a complete materialization check.",
            result.counts.errors > 0 ? "error" : "warning",
          ),
        ],
      };
    if (!result.valid)
      return {
        status: "findings",
        coverage: "limited",
        context,
        findings: [
          finding(
            "MATERIALIZATION_VALIDATION_FAILED",
            "Source validation found invalid materialization inputs.",
            result.counts.errors > 0 ? "error" : "warning",
          ),
        ],
      };
    if (result.drift.length || !result.clean)
      return {
        status: "findings",
        coverage: "limited",
        context,
        findings: [
          finding(
            "MATERIALIZATION_DRIFT",
            "Materialized outputs differ from the current source projection.",
            "error",
          ),
        ],
      };
    return { status: "ok", coverage: "limited", context };
  } catch {
    return blocked();
  }
}
