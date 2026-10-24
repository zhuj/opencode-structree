import type { MaterializedObject, ObjectRef, RelationKind } from "../src/lib/model/index.ts";

export const ref = (id: string, type = "feature"): ObjectRef => ({ type, id });
export function object(
  id: string,
  overrides: Partial<MaterializedObject> = {},
): MaterializedObject {
  return {
    ...ref(id),
    header: { title: id, retiredAt: null },
    body: "",
    source: { root: "vault", path: `features/${id}.md`, checksum: "synthetic" },
    references: [],
    fileBindings: [],
    ...overrides,
  };
}
export const relation = (id: string, kind: RelationKind = "depends", field = "dependencies") => ({
  field,
  kind,
  target: ref(id),
});
