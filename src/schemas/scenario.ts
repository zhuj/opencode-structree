import { Schema } from "effect";
import { BaseObjectSchema, IDSchema } from "./base";
import { FeatureIDSchema } from "./feature";
import { ProjectIDSchema } from "./project";

export const ScenarioIDSchema = IDSchema.annotate({
  description: "Scenario identifier. Must not be empty.",
});
export const ScenarioAcceptanceCriteriaIDSchema = IDSchema.annotate({
  description: "Scenario acceptance criteria identifier. Must not be empty.",
});

export const ScenarioSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  relations: Schema.Struct({
    project: ProjectIDSchema.annotate({
      description: "Required owning project identifier. Must not be empty.",
    }),
    partOf: Schema.NullOr(ScenarioIDSchema).annotate({
      description: "Optional parent scenario identifier. Must not be empty.",
    }),
    dependsOn: Schema.Array(ScenarioIDSchema).annotate({
      description: "Scenario identifiers this scenario depends on. Must not be empty.",
    }),
    commitment: Schema.Struct({
      features: Schema.Array(FeatureIDSchema).annotate({
        description: "Feature identifiers this scenario commits to. Must not be empty.",
      }),
    }).annotate({ description: "Scenario commitments to features." }),
  }).annotate({
    description: "Scenario ownership, hierarchy, dependencies, and feature commitments.",
  }),
});

export const ScenarioAcceptanceCriteriaSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  relations: Schema.Struct({
    scenario: ScenarioIDSchema.annotate({
      description: "Required owning scenario identifier. Must not be empty.",
    }),
    dependsOn: Schema.Array(ScenarioAcceptanceCriteriaIDSchema).annotate({
      description:
        "Scenario acceptance criteria identifiers these criteria depend on. Must not be empty.",
    }),
  }).annotate({
    description: "Acceptance criteria relationships, including their scenario and dependencies.",
  }),
});

export type Scenario = typeof ScenarioSchema.Type;
export type ScenarioAcceptanceCriteria = typeof ScenarioAcceptanceCriteriaSchema.Type;
