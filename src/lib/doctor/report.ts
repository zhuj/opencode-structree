import type { RecoveryRoot } from "../recovery/index.ts";
import type {
  DoctorFinding,
  DoctorProbeId,
  DoctorReport,
  FindingActionId,
  ProbeExecution,
  ProbeSummary,
} from "./types.ts";

const PAGE_SIZE = 100;

type InventoryCounts = {
  directories: number;
  entries: number;
  markdownFiles: number;
  unknownFiles: number;
  links: number;
};

const ACTION_IDS: ReadonlySet<string> = new Set([
  "inspect-source",
  "inspect-config",
  "inspect-cache",
  "retry-diagnosis",
]);

function safeRelative(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !/^[A-Za-z]:/.test(path) &&
    !path.includes("\\") &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function isFindingActionId(action: string): action is FindingActionId {
  return ACTION_IDS.has(action);
}

function safeFinding(finding: DoctorFinding): DoctorFinding {
  const { path, actions, message, ...rest } = finding;
  const safeActions = (actions ?? []).filter(isFindingActionId);
  const pathLeaked = message.includes("/") || message.includes("\\");
  return {
    ...rest,
    message: pathLeaked ? "The finding contained a path that was omitted." : message,
    ...(path && safeRelative(path) ? { path } : {}),
    ...(safeActions.length ? { actions: safeActions } : {}),
  };
}

function inventoryFinding(code: string, message: string): DoctorFinding {
  return { code, severity: "warning", capability: "inventory", message };
}

export async function inventoryProbe(
  root: RecoveryRoot,
  options: {
    readonly signal: AbortSignal;
    readonly deadline: number;
    readonly maxEntries: number;
    readonly maxDirectories: number;
  },
): Promise<ProbeExecution> {
  const findings: DoctorFinding[] = [];
  const counts: InventoryCounts = {
    directories: 1,
    entries: 0,
    markdownFiles: 0,
    unknownFiles: 0,
    links: 0,
  };
  const queue = [""];
  let coverage: "complete" | "limited" = "complete";
  while (queue.length > 0) {
    if (options.signal.aborted || Date.now() >= options.deadline) {
      coverage = "limited";
      findings.push(
        inventoryFinding(
          "INVENTORY_BUDGET",
          "Inventory stopped at its time or cancellation budget.",
        ),
      );
      break;
    }
    const directory = queue.shift();
    if (directory === undefined) break;
    let offset = 0;
    let expectedRevision: string | undefined;
    while (true) {
      if (
        options.signal.aborted ||
        Date.now() >= options.deadline ||
        counts.entries >= options.maxEntries
      ) {
        coverage = "limited";
        findings.push(
          inventoryFinding(
            "INVENTORY_BUDGET",
            "Inventory stopped at its time, entry, or cancellation budget.",
          ),
        );
        break;
      }
      const page = await root.listDirectory({
        path: directory,
        offset,
        limit: Math.min(PAGE_SIZE, options.maxEntries - counts.entries),
        ...(expectedRevision ? { expectedRevision } : {}),
        signal: options.signal,
      });
      if (page.status === "failed") {
        coverage = "limited";
        findings.push(
          inventoryFinding(
            "INVENTORY_LIST_FAILED",
            "A directory could not be completely inventoried.",
          ),
        );
        break;
      }
      if (page.status === "partial") {
        coverage = "limited";
        findings.push(
          inventoryFinding(
            "INVENTORY_LIST_PARTIAL",
            "Directory listing coverage is partial or its revision changed.",
          ),
        );
      }
      for (const entry of page.entries) {
        counts.entries++;
        if (entry.type === "directory") {
          if (counts.directories >= options.maxDirectories) {
            coverage = "limited";
            findings.push(
              inventoryFinding("INVENTORY_BUDGET", "Inventory stopped at its directory budget."),
            );
          } else if (entry.nameEncoding === "utf-8") {
            counts.directories++;
            queue.push(entry.path);
          }
        } else if (entry.type === "file") {
          if (entry.nameEncoding === "utf-8" && entry.name.toLowerCase().endsWith(".md"))
            counts.markdownFiles++;
          else counts.unknownFiles++;
        } else if (entry.type === "symlink") {
          counts.links++;
          findings.push(
            inventoryFinding(
              "SYMLINK_NOT_FOLLOWED",
              "A symbolic link was observed and not followed.",
            ),
          );
        } else {
          counts.unknownFiles++;
        }
      }
      if (page.status === "partial" || page.continuation === null) break;
      offset = page.continuation.offset;
      expectedRevision = page.continuation.revision;
    }
    if (coverage === "limited") break;
  }
  return { status: findings.length === 0 ? "ok" : "findings", coverage, context: counts, findings };
}

export function reportFrom(
  requestedProbes: readonly DoctorProbeId[],
  probes: readonly ProbeSummary[],
  findings: readonly DoctorFinding[],
): DoctorReport {
  const status = probes.some(
    (probe) =>
      probe.status === "blocked" ||
      probe.status === "failed" ||
      (probe.status !== "not-checked" &&
        probe.coverage !== "complete" &&
        probe.coverage !== "not-applicable"),
  )
    ? "incomplete"
    : "complete";
  return { version: 1, status, requestedProbes, probes, findings: findings.map(safeFinding) };
}

export function doctorExitCode(report: DoctorReport): 0 | 1 | 2 | 3 {
  if (report.status === "incomplete") return 3;
  if (report.findings.some((finding) => finding.severity === "error")) return 2;
  return 0;
}
