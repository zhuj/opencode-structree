import type {
  MaterializedObject,
  ObjectRef,
  RelationKind,
  ResolvedReference,
} from "../model/index.ts";
import { createObjectGraph, referenceKey } from "../model/index.ts";
import { compareEdges, compareRefs } from "./shared.ts";

export interface MermaidOptions {
  /** Weakly connected component in the type/kind-filtered graph. */
  readonly ref?: ObjectRef;
  readonly types?: readonly string[];
  readonly kinds?: readonly RelationKind[];
  readonly title?: string;
}

/** Mermaid decimal/named entities prevent labels from introducing diagram syntax. */
function escapeMermaid(text: string): string {
  return Array.from(text, (character) => {
    const code = character.charCodeAt(0);
    if (
      !'&"`<>#\\'.includes(character) &&
      code >= 32 &&
      code !== 127 &&
      code !== 0x2028 &&
      code !== 0x2029
    )
      return character;
    if (character === '"') return "#quot;";
    return `#${character.charCodeAt(0)};`;
  }).join("");
}

export function renderMermaid(
  objects: readonly MaterializedObject[],
  options: MermaidOptions = {},
): string {
  createObjectGraph(objects);
  const types = options.types && new Set(options.types);
  const kinds = options.kinds && new Set(options.kinds);
  let nodes = objects.filter((object) => !types || types.has(object.type)).sort(compareRefs);
  const keys = new Set(nodes.map(referenceKey));
  let edges: ResolvedReference[] = nodes
    .flatMap((object) =>
      object.references
        .filter((edge) => keys.has(referenceKey(edge.target)) && (!kinds || kinds.has(edge.kind)))
        .map((edge) => ({ ...edge, source: { type: object.type, id: object.id } })),
    )
    .sort(compareEdges);
  if (options.ref) {
    const root = referenceKey(options.ref);
    const adjacency = new Map<string, string[]>();
    for (const edge of edges) {
      const from = referenceKey(edge.source);
      const to = referenceKey(edge.target);
      adjacency.set(from, [...(adjacency.get(from) ?? []), to]);
      adjacency.set(to, [...(adjacency.get(to) ?? []), from]);
    }
    const reached = new Set<string>();
    const queue = keys.has(root) ? [root] : [];
    for (let i = 0; i < queue.length; i++) {
      const key = queue[i];
      if (key === undefined || reached.has(key)) continue;
      reached.add(key);
      queue.push(...(adjacency.get(key) ?? []).filter((next) => !reached.has(next)));
    }
    nodes = nodes.filter((node) => reached.has(referenceKey(node)));
    edges = edges.filter(
      (edge) => reached.has(referenceKey(edge.source)) && reached.has(referenceKey(edge.target)),
    );
  }
  // Fixed-width UTF-16 encoding is injective and avoids Mermaid's identifier grammar.
  const id = (ref: ObjectRef): string =>
    `n${referenceKey(ref)
      .split("")
      .map((unit) => unit.charCodeAt(0).toString(16).padStart(4, "0"))
      .join("")}`;
  const lines = ["flowchart TD"];
  if (options.title !== undefined) lines.push(`  accTitle: ${escapeMermaid(options.title)}`);
  for (const node of nodes) {
    const label =
      typeof node.header.title === "string"
        ? node.header.title
        : typeof node.header.name === "string"
          ? node.header.name
          : `${node.type}: ${node.id}`;
    lines.push(`  ${id(node)}["${escapeMermaid(referenceKey(node))}: ${escapeMermaid(label)}"]`);
  }
  for (const edge of edges)
    lines.push(
      `  ${id(edge.source)} -->|"${escapeMermaid(`${edge.field}: ${edge.kind}`)}"| ${id(edge.target)}`,
    );
  return `${lines.join("\n")}\n`;
}
