import { FrameworkError } from "../lib/errors.ts";
import type { ObjectFacade, ReadObject } from "../lib/types.ts";
import type { WorkItem } from "./schemas.ts";
import { type CompleteWorkItem, completeWorkItem, workItemDiagnostic } from "./source.ts";

export interface ProgressFinding {
  readonly code:
    | "CYCLE"
    | "MISSING_TARGET"
    | "PARTIAL_TARGET"
    | "UNVERIFIED_TARGET"
    | "GRAPH_LIMIT";
  readonly ids: readonly string[];
  readonly message: string;
}
export interface DependencyState {
  readonly id: string;
  readonly state:
    | "ready"
    | "waiting"
    | "verification-pending"
    | "missing"
    | "partial"
    | "unverified";
  readonly status?: WorkItem["status"];
  readonly verificationState?: WorkItem["verification"]["state"];
}

/** Parent pointers and dependencies are separate graphs: a parent may legitimately depend on a child. */
function relationCycles(items: ReadonlyMap<string, WorkItem>): ProgressFinding[] {
  const findings: ProgressFinding[] = [];
  for (const kind of ["parent", "dependsOn"] as const) {
    const finished = new Set<string>();
    const visiting = new Set<string>();
    function visit(id: string, trail: readonly string[]): readonly string[] | undefined {
      if (visiting.has(id)) return [...trail, id];
      if (finished.has(id)) return undefined;
      const item = items.get(id);
      if (!item) return undefined;
      visiting.add(id);
      const targets =
        kind === "parent"
          ? item.relations.parent
            ? [item.relations.parent]
            : []
          : item.relations.dependsOn;
      for (const target of targets) {
        const cycle = visit(target, [...trail, id]);
        if (cycle) return cycle;
      }
      visiting.delete(id);
      finished.add(id);
      return undefined;
    }
    for (const id of items.keys()) {
      const cycle = visit(id, []);
      if (cycle) {
        findings.push({
          code: "CYCLE",
          ids: cycle,
          message: `${kind} cycle detected; no readiness is implied.`,
        });
        break;
      }
    }
  }
  return findings;
}

/** The bound limits source reads, not claims of graph completeness. Missing/partial targets stay unknown. */
export async function inspectProgressGraph(
  facade: ObjectFacade,
  root: CompleteWorkItem,
  signal?: AbortSignal,
) {
  const sources = new Map<string, ReadObject | null>([[root.object.id, root]]);
  const findings: ProgressFinding[] = [];
  const finished = new Set<string>();
  const items = new Map<string, WorkItem>();
  async function visit(id: string): Promise<void> {
    signal?.throwIfAborted();
    if (finished.has(id)) return;
    if (!sources.has(id)) {
      if (sources.size >= 200) {
        if (!findings.some((finding) => finding.code === "GRAPH_LIMIT"))
          findings.push({
            code: "GRAPH_LIMIT",
            ids: [id],
            message:
              "Graph inspection stopped at 200 source objects; remaining targets are unknown.",
          });
        return;
      }
      try {
        sources.set(id, await facade.get("work_item", id, signal));
      } catch (error) {
        if (!(error instanceof FrameworkError) || error.code !== "NOT_FOUND") throw error;
        sources.set(id, null);
      }
    }
    const source = sources.get(id);
    finished.add(id);
    if (!source) {
      findings.push({
        code: "MISSING_TARGET",
        ids: [id],
        message: "Referenced work item is missing.",
      });
      return;
    }
    const diagnostic = workItemDiagnostic(source);
    if (diagnostic) {
      findings.push({
        code: diagnostic.kind === "unverified" ? "UNVERIFIED_TARGET" : "PARTIAL_TARGET",
        ids: [id],
        message:
          diagnostic.kind === "unverified"
            ? "Source identity is unverified; graph completeness is unknown."
            : "Referenced work item is partial or invalid; status is unknown.",
      });
      return;
    }
    const item = completeWorkItem(source).object;
    items.set(id, item);
    for (const target of [
      ...(item.relations.parent ? [item.relations.parent] : []),
      ...item.relations.dependsOn,
    ]) {
      await visit(target);
    }
  }
  await visit(root.object.id);
  findings.push(...relationCycles(items));
  const dependencies: DependencyState[] = root.object.relations.dependsOn.map((id) => {
    const source = sources.get(id);
    if (source === undefined) return { id, state: "unverified" };
    if (source === null) return { id, state: "missing" };
    const diagnostic = workItemDiagnostic(source);
    if (diagnostic)
      return { id, state: diagnostic.kind === "unverified" ? "unverified" : "partial" };
    const item = completeWorkItem(source).object;
    const state =
      item.status !== "completed"
        ? "waiting"
        : item.verification.state !== "passed" ||
            (!item.verification.evidence && !item.verification.testResult)
          ? "verification-pending"
          : "ready";
    return { id, state, status: item.status, verificationState: item.verification.state };
  });
  return {
    dependencies,
    dependencyReadiness:
      findings.some((finding) => finding.code === "CYCLE") ||
      dependencies.some((dependency) => dependency.state !== "ready")
        ? "not-ready"
        : findings.length > 0
          ? "unknown"
          : "ready",
    findings,
    graphComplete: findings.length === 0,
  };
}

export async function guardProgressRelations(
  facade: ObjectFacade,
  candidate: CompleteWorkItem,
  signal?: AbortSignal,
): Promise<void> {
  const graph = await inspectProgressGraph(facade, candidate, signal);
  const failures = graph.findings.filter(
    (finding) => finding.code === "CYCLE" || finding.code === "GRAPH_LIMIT",
  );
  if (failures.length)
    throw new FrameworkError(
      "VALIDATION_ERROR",
      "Work-item relations must be acyclic within the bounded source inspection.",
      { findings: failures },
    );
}
