import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { BaseObjectSchema } from "../src/lib/base-schema.ts";
import { ObjectRegistry } from "../src/lib/registry.ts";
import type { ObjectDefinition } from "../src/lib/types.ts";
import { coreDefinitions } from "../src/registry.ts";

/**
 * The approved relation model, written out independently of the implementation so a
 * declaration that is moved to another kind, target type or cardinality is caught.
 */
const APPROVED: readonly string[] = [
  "project|partOf|contains|project|one",
  "project_goal|project|owns|project|one",
  "project_goal|partOf|contains|project_goal|one",
  "feature|project|owns|project|one",
  "feature|commitment.goals|justifies|project_goal|many",
  "scenario|project|owns|project|one",
  "scenario|partOf|contains|scenario|one",
  "scenario|dependsOn|depends|scenario|many",
  "scenario|commitment.features|justifies|feature|many",
  "scenario_acceptance_criteria|scenario|owns|scenario|one",
  "scenario_acceptance_criteria|dependsOn|depends|scenario_acceptance_criteria|many",
  "adr|commitment.scenarios|justifies|scenario|many",
  "adr|partOf|contains|adr|one",
  "adr|dependsOn|depends|adr|many",
  "contract|partOf|contains|contract|one",
  "contract|dependsOn|depends|contract|many",
  "contract|commitsTo|justifies|adr|many",
  "interface|partOf|contains|interface|one",
  "interface|dependsOn|depends|interface|many",
  "interface|usedBy|uses|contract|many",
  "interface|commitsTo|justifies|adr|many",
  "entity|partOf|contains|entity|one",
  "entity|dependsOn|depends|entity|many",
  "entity|usedBy|uses|contract|many",
  "entity|usedIn|uses|interface|many",
  "entity|commitsTo|justifies|adr|many",
  "unit_test|partOf|contains|unit_test|one",
  "unit_test|dependsOn|depends|unit_test|many",
  "unit_test|relatesTo|relates|scenario_test|many",
  "unit_test|commitsTo|justifies|entity|many",
  "scenario_test|partOf|contains|scenario_test|one",
  "scenario_test|dependsOn|depends|scenario_test|many",
  "scenario_test|relatesTo|relates|acceptance_test|many",
  "scenario_test|commitsTo|justifies|interface|many",
  "acceptance_test|partOf|contains|acceptance_test|one",
  "acceptance_test|dependsOn|depends|acceptance_test|many",
  "acceptance_test|commitsTo|justifies|scenario_acceptance_criteria|many",
];

describe("relation declarations", () => {
  test("every registered relation field is declared exactly as the model states", () => {
    const declared: string[] = [];
    for (const definition of coreDefinitions) {
      for (const descriptor of definition.relations ?? []) {
        declared.push(
          `${definition.name}|${descriptor.path}|${descriptor.kind}|${descriptor.targetType}|${descriptor.cardinality}`,
        );
      }
    }
    expect(declared.sort()).toEqual([...APPROVED].sort());
  });

  test("a relation field provided by a later union branch is accepted", () => {
    const definition = {
      name: "choice",
      directory: "choices",
      description: "A type whose members each provide their own relation field.",
      schema: Schema.Union([
        Schema.Struct({
          ...BaseObjectSchema.fields,
          relations: Schema.Struct({ left: Schema.Array(Schema.String) }),
        }),
        Schema.Struct({
          ...BaseObjectSchema.fields,
          relations: Schema.Struct({ right: Schema.Array(Schema.String) }),
        }),
      ]),
      relations: [{ path: "right", kind: "depends", targetType: "choice", cardinality: "many" }],
    } as unknown as ObjectDefinition;
    expect(() => new ObjectRegistry([definition])).not.toThrow();
  });

  test("a relation field provided by a later branch of a suspended union is accepted", () => {
    const definition = {
      name: "choice",
      directory: "choices",
      description: "A suspended union of members with their own relation field.",
      schema: Schema.suspend(() =>
        Schema.Union([
          Schema.Struct({
            ...BaseObjectSchema.fields,
            relations: Schema.Struct({ left: Schema.Array(Schema.String) }),
          }),
          Schema.Struct({
            ...BaseObjectSchema.fields,
            relations: Schema.Struct({ right: Schema.Array(Schema.String) }),
          }),
        ]),
      ),
      relations: [{ path: "right", kind: "depends", targetType: "choice", cardinality: "many" }],
    } as unknown as ObjectDefinition;
    expect(() => new ObjectRegistry([definition])).not.toThrow();
  });

  test("a recursive relation schema without descriptors is accepted", () => {
    interface RecursiveLinks {
      readonly targets: readonly string[];
      readonly next: RecursiveLinks | null;
    }
    const recursiveLinks: Schema.Codec<RecursiveLinks, RecursiveLinks, never, never> =
      Schema.suspend(() =>
        Schema.Struct({
          targets: Schema.Array(Schema.String),
          next: Schema.NullOr(recursiveLinks),
        }),
      );
    const definition = {
      name: "recursive_links",
      directory: "recursive-links",
      description: "A recursive relation object without graph descriptors.",
      schema: Schema.Struct({ ...BaseObjectSchema.fields, relations: recursiveLinks }),
    } as unknown as ObjectDefinition;
    expect(() => new ObjectRegistry([definition])).not.toThrow();

    const withDescriptor = {
      ...definition,
      relations: [
        {
          path: "targets",
          kind: "depends",
          targetType: "recursive_links",
          cardinality: "many",
        },
        {
          path: "next.next.targets",
          kind: "depends",
          targetType: "recursive_links",
          cardinality: "many",
        },
      ],
    } as unknown as ObjectDefinition;
    const registry = new ObjectRegistry([withDescriptor]);
    expect(() => registry.assertRelationTargets()).not.toThrow();
  });
});
