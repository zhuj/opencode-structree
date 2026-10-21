import { Schema } from "effect";
import { BaseObjectSchema, IDSchema } from "./base";

export const ProjectIDSchema = IDSchema.annotate({
  description: "Project identifier. Must not be empty.",
});
export const ProjectGoalIDSchema = IDSchema.annotate({
  description: "Project goal identifier. Must not be empty.",
});

export const ProjectSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  relations: Schema.Struct({
    partOf: Schema.NullOr(ProjectIDSchema).annotate({
      description: "Optional parent project identifier. Must not be empty.",
    }),
  }).annotate({ description: "Project relationships, including an optional parent project." }),
});

export const ProjectGoalSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  relations: Schema.Struct({
    project: ProjectIDSchema.annotate({
      description: "Required owning project identifier. Must not be empty.",
    }),
    partOf: Schema.NullOr(ProjectGoalIDSchema).annotate({
      description: "Optional parent project goal identifier. Must not be empty.",
    }),
  }).annotate({
    description: "Project goal relationships, including its project and optional parent goal.",
  }),
});

export type Project = typeof ProjectSchema.Type;
export type ProjectGoal = typeof ProjectGoalSchema.Type;
