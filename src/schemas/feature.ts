import { Schema } from "effect";
import { BaseObjectSchema, IDSchema } from "./base";
import { ProjectGoalIDSchema, ProjectIDSchema } from "./project";

export const FeatureIDSchema = IDSchema.annotate({
  description: "Feature identifier. Must not be empty.",
});
export const FeatureSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  relations: Schema.Struct({
    project: ProjectIDSchema.annotate({
      description: "Required owning project identifier. Must not be empty.",
    }),
    commitment: Schema.Struct({
      goals: Schema.Array(ProjectGoalIDSchema).annotate({
        description: "Project goal identifiers this feature commits to. Must not be empty.",
      }),
    }).annotate({ description: "Feature commitments to project goals." }),
  }).annotate({
    description: "Feature relationships, including its project and goal commitments.",
  }),
});

export type Feature = typeof FeatureSchema.Type;
