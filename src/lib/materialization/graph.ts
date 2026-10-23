import type { SemanticReference } from "../model/index.ts";
import { directedCycleEdges } from "../relation-cycle-pruning.ts";
import { buildRelationGraph, candidatesFor, nodeKey } from "../relation-graph.ts";
import { relationFindings } from "../relations.ts";
import type { ObjectDefinition, ReadDocument } from "../types.ts";
import { atPath } from "./data.ts";
import type { Diagnostic } from "./types.ts";

export function validateGraph(
  documents: readonly ReadDocument[],
  definitions: readonly ObjectDefinition[],
): {
  readonly diagnostics: Diagnostic[];
  readonly references: ReadonlyMap<string, readonly SemanticReference[]>;
} {
  // Descriptors name decoded schema paths; plugin codecs may use a different wire shape.
  const semanticDocuments = documents.map((document) =>
    document.partial
      ? document
      : {
          ...document,
          json: { ...document.json, relations: atPath(document.object, "relations") },
        },
  );
  const graph = buildRelationGraph(semanticDocuments, definitions);
  const byNode = new Map(documents.map((d) => [nodeKey(d.type, d.object.id), d]));
  const diagnostics: Diagnostic[] = [];
  const references = new Map<string, SemanticReference[]>();
  for (const finding of relationFindings(graph.edges, [])) {
    const edge = finding.edge;
    const source = edge ? byNode.get(nodeKey(edge.from.type, edge.from.id)) : undefined;
    diagnostics.push({
      code: finding.code,
      severity: "error",
      message: finding.message,
      ...(edge
        ? {
            ...(source ? { path: source.path } : {}),
            field: edge.field,
            object: { type: edge.from.type, id: edge.from.id },
          }
        : {}),
    });
  }
  for (const document of semanticDocuments) {
    for (const descriptor of definitions.find((d) => d.name === document.type)?.relations ?? []) {
      const field = `relations.${descriptor.path}`;
      const value = atPath(document.json, field);
      const valid =
        value === undefined ||
        (descriptor.cardinality === "one"
          ? value === null || typeof value === "string"
          : Array.isArray(value) && value.every((id) => typeof id === "string"));
      if (!valid)
        diagnostics.push({
          code: "RELATION_CARDINALITY",
          severity: "error",
          path: document.path,
          field,
          object: { type: document.type, id: document.object.id },
          message: `Expected relation cardinality '${descriptor.cardinality}'.`,
        });
    }
  }
  const traversal = {
    mode: "impact",
    direction: "outgoing",
    kinds: new Set(["depends", "uses", "justifies", "contains", "owns"] as const),
    depth: graph.nodes.size + 1,
  } as const;
  const adjacency = new Map(
    [...graph.nodes.keys()].map((key) => [key, candidatesFor(graph, key, traversal)]),
  );
  const cycles = directedCycleEdges(adjacency);
  for (const edge of graph.edges) {
    const document = byNode.get(edge.fromKey);
    const common = {
      severity: "error",
      ...(document ? { path: document.path } : {}),
      field: edge.field,
      object: { type: edge.from.type, id: edge.from.id },
    } as const;
    if (cycles.has(edge.index))
      diagnostics.push({
        ...common,
        code: "CYCLE",
        message: "Relation participates in a directed impact or containment cycle.",
      });
    const refs = references.get(edge.fromKey) ?? [];
    refs.push({
      field: edge.field,
      kind: edge.kind,
      target: { type: edge.declaredType, id: edge.to.id },
    });
    references.set(edge.fromKey, refs);
  }
  return { diagnostics, references };
}
