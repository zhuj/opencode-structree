import type { MaterializedObject, SemanticReference } from "../src/lib/model/index.ts";

export function object(id = "one", patch: Partial<MaterializedObject> = {}): MaterializedObject {
  return {
    type: "feature",
    id,
    header: {},
    body: "body",
    source: { root: "vault", path: `${id}.md`, checksum: "checksum" },
    references: [],
    fileBindings: [],
    ...patch,
  };
}

export function reference(id: string, field = "requires"): SemanticReference {
  return { field, kind: "depends", target: { type: "feature", id } };
}
