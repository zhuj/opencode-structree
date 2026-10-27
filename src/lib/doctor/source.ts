import { openRecoveryRoot, type RecoveryRoot } from "../recovery/index.ts";
import { doctorExitCode, inventoryProbe, reportFrom } from "./report.ts";
import {
  DOCTOR_PROBES,
  type DoctorFinding,
  type DoctorOptions,
  type DoctorProbeId,
  type DoctorReport,
  type ProbeExecution,
  type ProbeSummary,
} from "./types.ts";

const MAX_ENTRIES = 1000;
const MAX_DIRECTORIES = 100;
const MAX_BUDGET_MS = 30_000;

function failureFinding(code: string, capability: DoctorProbeId, message: string): DoctorFinding {
  return { code, severity: "warning", capability, message };
}

function summarize(
  id: DoctorProbeId,
  result: ProbeExecution,
  findings: DoctorFinding[],
): ProbeSummary {
  findings.push(...(result.findings ?? []));
  if (result.status === "failed")
    findings.push(failureFinding("PROBE_FAILED", id, "The requested diagnostic probe failed."));
  if (result.status === "blocked")
    findings.push(
      failureFinding("PROBE_BLOCKED", id, "The requested diagnostic probe could not run."),
    );
  const context = result.context ?? {};
  switch (result.status) {
    case "ok":
    case "findings":
      return { id, status: result.status, coverage: result.coverage, context };
    case "blocked":
      return { id, status: "blocked", coverage: "unknown", context };
    case "failed":
      return { id, status: "failed", coverage: "unknown", context };
    default:
      return assertNever(result.status);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled doctor probe result: ${String(value)}`);
}

function validateLimits(options: DoctorOptions): {
  maxEntries: number;
  maxDirectories: number;
  budgetMs: number;
} {
  const maxEntries = options.limits?.maxEntries ?? MAX_ENTRIES;
  const maxDirectories = options.limits?.maxDirectories ?? MAX_DIRECTORIES;
  const budgetMs = options.budgetMs ?? MAX_BUDGET_MS;
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > MAX_ENTRIES)
    throw new RangeError("Doctor entry budget must be between 1 and 1000.");
  if (
    !Number.isSafeInteger(maxDirectories) ||
    maxDirectories < 1 ||
    maxDirectories > MAX_DIRECTORIES
  )
    throw new RangeError("Doctor directory budget must be between 1 and 100.");
  if (!Number.isSafeInteger(budgetMs) || budgetMs < 1 || budgetMs > MAX_BUDGET_MS)
    throw new RangeError("Doctor time budget must be between 1 and 30000 milliseconds.");
  return { maxEntries, maxDirectories, budgetMs };
}

function notChecked(id: DoctorProbeId): ProbeSummary {
  return { id, status: "not-checked", coverage: "not-applicable", context: {} };
}

/** Read-only metadata diagnosis. The deadline admits cooperative work; it cannot interrupt an active OS call. */
export async function runDoctorReport(options: DoctorOptions): Promise<DoctorReport> {
  const limits = validateLimits(options);
  const selected = options.probes ?? ["root", "inventory"];
  const requested = [
    ...new Set([...selected, ...(options.builtinProbes ?? []).map((probe) => probe.id)]),
  ];
  if (requested.some((id) => !DOCTOR_PROBES.includes(id)))
    throw new TypeError("Unknown doctor probe selection.");
  const findings: DoctorFinding[] = [];
  const summaries = new Map<DoctorProbeId, ProbeSummary>();
  let opened: RecoveryRoot | undefined;
  const needsRoot = selected.includes("root") || selected.includes("inventory");
  const deadline = Date.now() + limits.budgetMs;
  const budgetController = new AbortController();
  const abortForCaller = (): void => budgetController.abort();
  if (options.signal?.aborted) abortForCaller();
  else options.signal?.addEventListener("abort", abortForCaller, { once: true });
  const timer = setTimeout(abortForCaller, limits.budgetMs);
  const signal = budgetController.signal;
  try {
    if (needsRoot && !signal.aborted) {
      const result = await openRecoveryRoot(options.root);
      if (result.status === "opened") opened = result.root;
      else {
        findings.push(
          failureFinding(
            "ROOT_UNAVAILABLE",
            "root",
            "The selected existing root could not be opened.",
          ),
        );
        if (selected.includes("root"))
          summaries.set("root", {
            id: "root",
            status: "failed",
            coverage: "unknown",
            context: {},
          });
        if (selected.includes("inventory"))
          summaries.set("inventory", {
            id: "inventory",
            status: "blocked",
            coverage: "unknown",
            context: {},
          });
      }
      if (opened && selected.includes("root"))
        summaries.set("root", {
          id: "root",
          status: "ok",
          coverage: "complete",
          context: { opened: 1 },
        });
    } else if (needsRoot) {
      findings.push(
        failureFinding(
          "PROBE_BUDGET",
          "root",
          "The selected root probe did not start within its budget.",
        ),
      );
      if (selected.includes("root"))
        summaries.set("root", { id: "root", status: "blocked", coverage: "unknown", context: {} });
      if (selected.includes("inventory"))
        summaries.set("inventory", {
          id: "inventory",
          status: "blocked",
          coverage: "unknown",
          context: {},
        });
    }
    if (opened && selected.includes("inventory"))
      summaries.set(
        "inventory",
        summarize(
          "inventory",
          await inventoryProbe(opened, {
            signal,
            deadline,
            maxEntries: limits.maxEntries,
            maxDirectories: limits.maxDirectories,
          }),
          findings,
        ),
      );
    for (const probe of options.builtinProbes ?? []) {
      if (signal.aborted || Date.now() >= deadline) {
        findings.push(
          failureFinding(
            "PROBE_BUDGET",
            probe.id,
            "The requested diagnostic probe did not start within its budget.",
          ),
        );
        summaries.set(probe.id, {
          id: probe.id,
          status: "blocked",
          coverage: "unknown",
          context: {},
        });
        continue;
      }
      try {
        const result = await probe.run({
          ...(opened ? { root: opened } : {}),
          signal,
        });
        summaries.set(probe.id, summarize(probe.id, result, findings));
      } catch {
        findings.push(
          failureFinding("PROBE_FAILED", probe.id, "The requested diagnostic probe failed."),
        );
        summaries.set(probe.id, {
          id: probe.id,
          status: "failed",
          coverage: "unknown",
          context: {},
        });
      }
    }
  } finally {
    try {
      await opened?.close();
    } catch {
      findings.push(
        failureFinding(
          "ROOT_CLOSE_FAILED",
          "root",
          "The diagnostic root handle could not be closed cleanly.",
        ),
      );
      if (requested.includes("root"))
        summaries.set("root", { id: "root", status: "failed", coverage: "unknown", context: {} });
      else if (requested.includes("inventory"))
        summaries.set("inventory", {
          id: "inventory",
          status: "findings",
          coverage: "limited",
          context: {},
        });
    }
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abortForCaller);
  }
  const probes = DOCTOR_PROBES.map((id) => {
    const summary = summaries.get(id);
    if (summary) return summary;
    if (!requested.includes(id)) return notChecked(id);
    findings.push(
      failureFinding("PROBE_UNAVAILABLE", id, "The requested diagnostic probe is unavailable."),
    );
    return { id, status: "blocked", coverage: "unknown", context: {} } as const;
  });
  return reportFrom(requested, probes, findings);
}

export { doctorExitCode };
