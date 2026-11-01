import { ObjectRegistry } from "../lib/registry.ts";
import type { ObjectDefinition, RelationDescriptor } from "../lib/types.ts";
import type { ObjectFieldsDefinition } from "../object-fields/types.ts";
import { MemorySchema } from "./schemas/index.ts";

const relations: readonly RelationDescriptor[] = [
  { path: "buildsOn", kind: "depends", targetType: "memory", cardinality: "many" },
  { path: "supersedes", kind: "relates", targetType: "memory", cardinality: "many" },
  { path: "contradicts", kind: "relates", targetType: "memory", cardinality: "many" },
  { path: "relatedTo", kind: "relates", targetType: "memory", cardinality: "many" },
  { path: "implements", kind: "justifies", targetType: "memory", cardinality: "many" },
  { path: "constrains", kind: "relates", targetType: "memory", cardinality: "many" },
  { path: "motivatedBy", kind: "justifies", targetType: "memory", cardinality: "many" },
  { path: "validatedBy", kind: "justifies", targetType: "memory", cardinality: "many" },
];

export const memoryDefinition: ObjectFieldsDefinition<"common"> = Object.freeze({
  name: "memory",
  directory: "memories",
  description:
    "Reusable project knowledge in twelve categories. Category sections and claim provenance remain Markdown. Status and confidence are authored, not inferred truth.",
  schema: MemorySchema,
  fieldsProfile: "common",
  relations,
});
export const memoryDefinitions = Object.freeze([memoryDefinition]);
export const createMemoryRegistry = (): ObjectRegistry => new ObjectRegistry(memoryDefinitions);

/** A coincidentally named custom type must not acquire domain-specific tools. */
export function isMemoryDefinition(definition: ObjectDefinition): boolean {
  return (
    definition.name === "memory" &&
    definition.schema === MemorySchema &&
    definition.relations?.length === relations.length &&
    relations.every((expected) =>
      definition.relations?.some(
        (actual) =>
          actual.path === expected.path &&
          actual.kind === expected.kind &&
          actual.targetType === expected.targetType &&
          actual.cardinality === expected.cardinality,
      ),
    )
  );
}
