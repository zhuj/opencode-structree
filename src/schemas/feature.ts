import { Schema } from "effect";
import { BaseObjectSchema, IDSchema } from "./base";
import { ProjectGoalIDSchema, ProjectIDSchema } from "./project";

export const FeatureIDSchema = IDSchema.annotate({ description: "Feature identifier." });
export const FeatureSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  relations: Schema.Struct({
    project: ProjectIDSchema.annotate({ description: "Required owning project identifier." }),
    commitment: Schema.Struct({
      goals: Schema.Array(ProjectGoalIDSchema).annotate({
        description: "Project goal identifiers this feature commits to.",
      }),
    }).annotate({ description: "Feature commitments to project goals." }),
  }).annotate({
    description: "Feature relationships, including its project and goal commitments.",
  }),
});

export type Feature = typeof FeatureSchema.Type;
