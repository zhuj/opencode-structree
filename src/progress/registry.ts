import { ObjectRegistry } from "../lib/registry.ts";
import type { ObjectDefinition, RelationDescriptor } from "../lib/types.ts";
import type { ObjectFieldsDefinition } from "../object-fields/types.ts";
import { WorkItemSchema } from "./schemas.ts";

const relations: readonly RelationDescriptor[] = [
  { path: "parent", kind: "relates", targetType: "work_item", cardinality: "one" },
  { path: "dependsOn", kind: "depends", targetType: "work_item", cardinality: "many" },
];
export const workItemDefinition: ObjectFieldsDefinition<"common"> = Object.freeze({
  name: "work_item",
  directory: "work-items",
  description:
    "Resumable work with explicit outcomes, checkpoints and separately authored verification. Completion never establishes acceptance.",
  schema: WorkItemSchema,
  fieldsProfile: "common",
  relations,
});
export const progressDefinitions = Object.freeze([workItemDefinition]);
export const createProgressRegistry = (): ObjectRegistry => new ObjectRegistry(progressDefinitions);

export function isProgressDefinition(definition: ObjectDefinition): boolean {
  return (
    definition.name === "work_item" &&
    definition.schema === WorkItemSchema &&
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
