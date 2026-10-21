import { Schema } from "effect";
import { BaseObjectSchema, idSchema } from "./base";
import { ScenarioIDSchema } from "./scenario";

export const ADRIDSchema = idSchema(
  "Architecture decision record identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
);
export const ADRSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  relations: Schema.Struct({
    commitment: Schema.Struct({
      scenarios: Schema.Array(ScenarioIDSchema).annotate({
        description:
          "Scenario identifiers this architecture decision commits to. Must be a portable file name of at most 200 UTF-8 bytes.",
      }),
    }).annotate({ description: "Architecture decision commitments to scenarios." }),
    partOf: Schema.NullOr(ADRIDSchema).annotate({
      description:
        "Optional parent architecture decision record identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
    }),
    dependsOn: Schema.Array(ADRIDSchema).annotate({
      description:
        "Architecture decision record identifiers this decision depends on. Must be a portable file name of at most 200 UTF-8 bytes.",
    }),
  }).annotate({
    description: "Architecture decision hierarchy, dependencies, and scenario commitments.",
  }),
});

export type ADR = typeof ADRSchema.Type;
