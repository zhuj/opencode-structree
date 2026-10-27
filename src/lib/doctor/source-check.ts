import { validateObjects } from "../materialization/validate.ts";
import type { DoctorCheckOptions } from "./checks.ts";
import type { DoctorFinding, FindingSeverity, ProbeExecution } from "./types.ts";

function finding(
  code: string,
  message: string,
  severity: FindingSeverity = "warning",
): DoctorFinding {
  return { capability: "source-validation", code, severity, message, actions: ["inspect-source"] };
}

function blocked(): ProbeExecution {
  return {
    status: "blocked",
    coverage: "unknown",
    findings: [
      {
        ...finding("SOURCE_UNAVAILABLE", "The selected source directory could not be validated."),
        actions: ["retry-diagnosis"],
      },
    ],
  };
}

export async function runSourceCheck(
  options: DoctorCheckOptions,
  signal?: AbortSignal,
): Promise<ProbeExecution> {
  if (!options.definitions?.length) return blocked();
  try {
    signal?.throwIfAborted();
    const result = await validateObjects({
      definitions: options.definitions,
      projectRoot: options.projectRoot,
      vaultRoot: options.sourceRoot,
      ...(signal ? { signal } : {}),
    });
    const context = {
      scanned: result.counts.scanned,
      complete: result.counts.complete,
      partial: result.counts.partial,
      errors: result.counts.errors,
    };
    if (result.diagnostics.some((item) => ["VALIDATION_SETUP", "ABORTED"].includes(item.code)))
      return blocked();
    const unobserved = result.diagnostics.some((item) =>
      ["SOURCE_READ", "SOURCE_PATH", "UNKNOWN_SOURCE_TYPE", "FILE_BINDING"].includes(item.code),
    );
    const limited = unobserved || result.counts.partial > 0;
    if (!result.valid || limited)
      return {
        status: "findings",
        coverage: limited ? "limited" : "complete",
        context,
        findings: [
          finding(
            "SOURCE_INVALID",
            "Source validation reported invalid or incomplete objects.",
            result.counts.errors > 0 ? "error" : "warning",
          ),
        ],
      };
    return { status: "ok", coverage: "complete", context };
  } catch {
    return blocked();
  }
}
