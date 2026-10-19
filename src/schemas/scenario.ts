import { Schema } from "effect";
import { BaseObjectSchema, IDSchema } from "./base";
import { FeatureIDSchema } from "./feature";
import { ProjectIDSchema } from "./project";

export const ScenarioIDSchema = IDSchema.annotate({ description: "Scenario identifier." });
export const ScenarioAcceptanceCriteriaIDSchema = IDSchema.annotate({
  description: "Scenario acceptance criteria identifier.",
});

export const ScenarioSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  relations: Schema.Struct({
    project: ProjectIDSchema.annotate({ description: "Required owning project identifier." }),
    partOf: Schema.NullOr(ScenarioIDSchema).annotate({
      description: "Optional parent scenario identifier.",
    }),
    dependsOn: Schema.Array(ScenarioIDSchema).annotate({
      description: "Scenario identifiers this scenario depends on.",
    }),
    commitment: Schema.Struct({
      features: Schema.Array(FeatureIDSchema).annotate({
        description: "Feature identifiers this scenario commits to.",
      }),
    }).annotate({ description: "Scenario commitments to features." }),
  }).annotate({
    description: "Scenario ownership, hierarchy, dependencies, and feature commitments.",
  }),
});

export const ScenarioAcceptanceCriteriaSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  relations: Schema.Struct({
    scenario: ScenarioIDSchema.annotate({ description: "Required owning scenario identifier." }),
    dependsOn: Schema.Array(ScenarioAcceptanceCriteriaIDSchema).annotate({
      description: "Scenario acceptance criteria identifiers these criteria depend on.",
    }),
  }).annotate({
    description: "Acceptance criteria relationships, including their scenario and dependencies.",
  }),
});

export type Scenario = typeof ScenarioSchema.Type;
export type ScenarioAcceptanceCriteria = typeof ScenarioAcceptanceCriteriaSchema.Type;
