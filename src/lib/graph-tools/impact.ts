import type {
  MaterializedObject,
  ObjectRef,
  ProjectFileBinding,
  RelationKind,
} from "../model/index.ts";
import { createObjectGraph, referenceKey } from "../model/index.ts";
import {
  active,
  compareEdges,
  compareRefs,
  compareText,
  identity,
  portablePath,
} from "./shared.ts";

export const IMPACT_KINDS: readonly RelationKind[] = [
  "depends",
  "uses",
  "justifies",
  "contains",
  "owns",
];
export interface ImpactOptions {
  readonly kinds?: readonly RelationKind[];
  readonly depth?: number;
  readonly includeRetired?: boolean;
}
export interface ImpactStep {
  readonly from: ObjectRef;
  readonly to: ObjectRef;
  readonly field: string;
  readonly kind: RelationKind;
}
export interface ImpactEntry {
  readonly viaDepth: number;
  readonly origin: ObjectRef;
  /** Root-outward order; each step describes the holder's actual directed reference. */
  readonly path: readonly ImpactStep[];
}
export interface AffectedFile extends ProjectFileBinding {
  readonly origins: readonly ObjectRef[];
}
export interface ImpactReport {
  readonly entries: readonly ImpactEntry[];
  /** Candidate bindings, not evidence that tests have run or passed. */
  readonly files: readonly AffectedFile[];
}

export function impactReport(
  objects: readonly MaterializedObject[],
  ref: ObjectRef,
  options: ImpactOptions = {},
): ImpactReport {
  const graph = createObjectGraph(objects);
  const depth = options.depth ?? Number.POSITIVE_INFINITY;
  if (options.depth !== undefined && (!Number.isSafeInteger(depth) || depth < 0))
    throw new RangeError("Impact depth must be a nonnegative safe integer");
  const root = graph.resolve(ref);
  if (!root || (options.includeRetired === false && !active(root)))
    return { entries: [], files: [] };
  // relates never implies impact, even if supplied explicitly by a caller.
  const kinds = new Set<RelationKind>(
    (options.kinds ?? IMPACT_KINDS).filter((kind) => kind !== "relates"),
  );
  const entries: ImpactEntry[] = [];
  const visited = new Set([referenceKey(root)]);
  let layer: ImpactEntry[] = [{ origin: identity(root), viaDepth: 0, path: [] }];
  while (layer.length) {
    entries.push(...layer);
    const next = new Map<string, ImpactEntry>();
    for (const entry of layer) {
      if (entry.viaDepth >= depth) continue;
      for (const edge of [...graph.incoming(entry.origin)].sort(compareEdges)) {
        const holder = graph.resolve(edge.source);
        const key = referenceKey(edge.source);
        if (
          !holder ||
          !kinds.has(edge.kind) ||
          visited.has(key) ||
          (options.includeRetired === false && !active(holder))
        )
          continue;
        visited.add(key);
        next.set(key, {
          origin: identity(holder),
          viaDepth: entry.viaDepth + 1,
          path: [
            ...entry.path,
            {
              from: identity(edge.source),
              to: identity(edge.target),
              field: edge.field,
              kind: edge.kind,
            },
          ],
        });
      }
    }
    layer = [...next.values()].sort((a, b) => compareRefs(a.origin, b.origin));
  }
  const files = new Map<string, { binding: ProjectFileBinding; origins: ObjectRef[] }>();
  for (const entry of entries) {
    for (const binding of graph.resolve(entry.origin)?.fileBindings ?? []) {
      const normalized = { ...binding, path: portablePath(binding.path) ?? binding.path };
      const key = JSON.stringify([normalized.path, binding.role, binding.symbol ?? null]);
      const aggregate = files.get(key) ?? { binding: normalized, origins: [] };
      if (!aggregate.origins.some((origin) => referenceKey(origin) === referenceKey(entry.origin)))
        aggregate.origins.push(entry.origin);
      files.set(key, aggregate);
    }
  }
  return {
    entries,
    files: [...files.entries()]
      .sort(([a], [b]) => compareText(a, b))
      .map(([, file]) => ({ ...file.binding, origins: file.origins.sort(compareRefs) })),
  };
}
