import { Schema } from "effect";
import { BaseObjectSchema, IDSchema } from "./base";
import { ScenarioIDSchema } from "./scenario";

export const ADRIDSchema = IDSchema.annotate({
  description: "Architecture decision record identifier.",
});
export const ADRSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  relations: Schema.Struct({
    commitment: Schema.Struct({
      scenarios: Schema.Array(ScenarioIDSchema).annotate({
        description: "Scenario identifiers this architecture decision commits to.",
      }),
    }).annotate({ description: "Architecture decision commitments to scenarios." }),
    partOf: Schema.NullOr(ADRIDSchema).annotate({
      description: "Optional parent architecture decision record identifier.",
    }),
    dependsOn: Schema.Array(ADRIDSchema).annotate({
      description: "Architecture decision record identifiers this decision depends on.",
    }),
  }).annotate({
    description: "Architecture decision hierarchy, dependencies, and scenario commitments.",
  }),
});

export type ADR = typeof ADRSchema.Type;
