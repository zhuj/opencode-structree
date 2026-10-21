import { Schema } from "effect";
import { BaseObjectSchema, idSchema } from "./base";
import { FeatureIDSchema } from "./feature";

export const ScenarioIDSchema = idSchema(
  "Scenario identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
);
export const ScenarioAcceptanceCriteriaIDSchema = idSchema(
  "Scenario acceptance criteria identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
);

export const ScenarioSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  relations: Schema.Struct({
    project: idSchema(
      "Required owning project identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
    ),
    partOf: Schema.NullOr(ScenarioIDSchema).annotate({
      description:
        "Optional parent scenario identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
    }),
    dependsOn: Schema.Array(ScenarioIDSchema).annotate({
      description:
        "Scenario identifiers this scenario depends on. Must be a portable file name of at most 200 UTF-8 bytes.",
    }),
    commitment: Schema.Struct({
      features: Schema.Array(FeatureIDSchema).annotate({
        description:
          "Feature identifiers this scenario commits to. Must be a portable file name of at most 200 UTF-8 bytes.",
      }),
    }).annotate({ description: "Scenario commitments to features." }),
  }).annotate({
    description: "Scenario ownership, hierarchy, dependencies, and feature commitments.",
  }),
});

export const ScenarioAcceptanceCriteriaSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  relations: Schema.Struct({
    scenario: idSchema(
      "Required owning scenario identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
    ),
    dependsOn: Schema.Array(ScenarioAcceptanceCriteriaIDSchema).annotate({
      description:
        "Scenario acceptance criteria identifiers these criteria depend on. Must be a portable file name of at most 200 UTF-8 bytes.",
    }),
  }).annotate({
    description: "Acceptance criteria relationships, including their scenario and dependencies.",
  }),
});

export type Scenario = typeof ScenarioSchema.Type;
export type ScenarioAcceptanceCriteria = typeof ScenarioAcceptanceCriteriaSchema.Type;
