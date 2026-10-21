import { Schema } from "effect";
import { BaseObjectSchema, IDSchema } from "./base";
import { ScenarioIDSchema } from "./scenario";

export const ADRIDSchema = IDSchema.annotate({
  description: "Architecture decision record identifier. Must not be empty.",
});
export const ADRSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  relations: Schema.Struct({
    commitment: Schema.Struct({
      scenarios: Schema.Array(ScenarioIDSchema).annotate({
        description:
          "Scenario identifiers this architecture decision commits to. Must not be empty.",
      }),
    }).annotate({ description: "Architecture decision commitments to scenarios." }),
    partOf: Schema.NullOr(ADRIDSchema).annotate({
      description: "Optional parent architecture decision record identifier. Must not be empty.",
    }),
    dependsOn: Schema.Array(ADRIDSchema).annotate({
      description:
        "Architecture decision record identifiers this decision depends on. Must not be empty.",
    }),
  }).annotate({
    description: "Architecture decision hierarchy, dependencies, and scenario commitments.",
  }),
});

export type ADR = typeof ADRSchema.Type;
