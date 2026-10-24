import type {
  MaterializedObject,
  ObjectRef,
  RelationKind,
  ResolvedReference,
} from "../model/index.ts";
import { createObjectGraph } from "../model/index.ts";
import { active, compareEdges, compareRefs, identity } from "./shared.ts";

export interface TraceabilityOptions {
  readonly originType: string;
  readonly evidenceType: string;
  readonly kind: RelationKind;
  /** Evidence is active when retiredAt is null or absent. Origins are never hidden. */
  readonly requireActive?: boolean;
}
export interface TraceabilityRow {
  readonly origin: ObjectRef;
  readonly evidences: readonly ResolvedReference[];
  readonly satisfied: boolean;
}

/** Evidence holders point to origins. Missing coverage remains an explicit row. */
export function traceability(
  objects: readonly MaterializedObject[],
  options: TraceabilityOptions,
): readonly TraceabilityRow[] {
  const graph = createObjectGraph(objects);
  return objects
    .filter((object) => object.type === options.originType)
    .sort(compareRefs)
    .map((origin) => {
      const evidences = graph
        .incoming(origin)
        .filter((edge) => {
          const holder = graph.resolve(edge.source);
          return (
            holder?.type === options.evidenceType &&
            edge.kind === options.kind &&
            (!options.requireActive || active(holder))
          );
        })
        .sort(compareEdges);
      return { origin: identity(origin), evidences, satisfied: evidences.length > 0 };
    });
}
