import { Schema } from "effect";
import { BaseObjectSchema, idSchema } from "./base";
import { ProjectGoalIDSchema } from "./project";

export const FeatureIDSchema = idSchema(
  "Feature identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
);
export const FeatureSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  relations: Schema.Struct({
    project: idSchema(
      "Required owning project identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
    ),
    commitment: Schema.Struct({
      goals: Schema.Array(ProjectGoalIDSchema).annotate({
        description:
          "Project goal identifiers this feature commits to. Must be a portable file name of at most 200 UTF-8 bytes.",
      }),
    }).annotate({ description: "Feature commitments to project goals." }),
  }).annotate({
    description: "Feature relationships, including its project and goal commitments.",
  }),
});

export type Feature = typeof FeatureSchema.Type;
