import { Schema } from "effect";
import { BaseObjectSchema, IDSchema } from "./base";

export const ProjectIDSchema = IDSchema.annotate({ description: "Project identifier." });
export const ProjectGoalIDSchema = IDSchema.annotate({ description: "Project goal identifier." });

export const ProjectSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  relations: Schema.Struct({
    partOf: Schema.NullOr(ProjectIDSchema).annotate({
      description: "Optional parent project identifier.",
    }),
  }).annotate({ description: "Project relationships, including an optional parent project." }),
});

export const ProjectGoalSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  relations: Schema.Struct({
    project: ProjectIDSchema.annotate({ description: "Required owning project identifier." }),
    partOf: Schema.NullOr(ProjectGoalIDSchema).annotate({
      description: "Optional parent project goal identifier.",
    }),
  }).annotate({
    description: "Project goal relationships, including its project and optional parent goal.",
  }),
});

export type Project = typeof ProjectSchema.Type;
export type ProjectGoal = typeof ProjectGoalSchema.Type;
