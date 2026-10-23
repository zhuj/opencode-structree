/** JSON wire values deliberately exclude Date and executable values. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface ObjectRef<Type extends string = string, Id extends string = string> {
  readonly type: Type;
  readonly id: Id;
}
export type RelationKind = "depends" | "uses" | "justifies" | "contains" | "owns" | "relates";
export interface SourceProvenance {
  readonly root: "vault";
  readonly path: string;
  readonly checksum: string;
}
export interface ProjectFileBinding {
  readonly root: "project";
  readonly path: string;
  readonly role: "implementation" | "test" | "documentation";
  readonly symbol?: string;
}
export interface SemanticReference {
  readonly field: string;
  readonly kind: RelationKind;
  readonly target: ObjectRef;
}
export interface MaterializedObject<Type extends string = string, Id extends string = string>
  extends ObjectRef<Type, Id> {
  readonly header: JsonObject;
  readonly body: string;
  readonly source: SourceProvenance;
  readonly references: readonly SemanticReference[];
  readonly fileBindings: readonly ProjectFileBinding[];
}
export interface ResolvedReference extends SemanticReference {
  readonly source: ObjectRef;
}
export interface ObjectGraph<Object extends MaterializedObject = MaterializedObject> {
  readonly objects: readonly Object[];
  resolve(ref: ObjectRef): Object | undefined;
  outgoing(ref: ObjectRef): readonly SemanticReference[];
  incoming(ref: ObjectRef): readonly ResolvedReference[];
}

/** Tuple encoding keeps identity unambiguous even when names contain punctuation. */
export const referenceKey = (ref: ObjectRef): string => JSON.stringify([ref.type, ref.id]);

/** References remain data; cycles never require eager cross-module object imports. */
export function createObjectGraph<const Object extends MaterializedObject>(
  objects: readonly Object[],
): ObjectGraph<Object> {
  const byIdentity = new Map<string, Object>();
  const incoming = new Map<string, ResolvedReference[]>();
  for (const object of objects) {
    const key = referenceKey(object);
    if (byIdentity.has(key)) throw new TypeError(`Duplicate object identity: ${key}`);
    byIdentity.set(key, object);
    for (const reference of object.references) {
      const key = referenceKey(reference.target);
      const entries = incoming.get(key) ?? [];
      entries.push({ ...reference, source: { type: object.type, id: object.id } });
      incoming.set(key, entries);
    }
  }
  return {
    objects: [...objects],
    resolve: (ref) => byIdentity.get(referenceKey(ref)),
    outgoing: (ref) => byIdentity.get(referenceKey(ref))?.references ?? [],
    incoming: (ref) => incoming.get(referenceKey(ref)) ?? [],
  };
}
