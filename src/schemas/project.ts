import { Schema } from "effect";
import { BaseObjectSchema, idSchema } from "./base";

export const ProjectIDSchema = idSchema(
  "Project identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
);
export const ProjectGoalIDSchema = idSchema(
  "Project goal identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
);

export const ProjectSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  relations: Schema.Struct({
    partOf: Schema.NullOr(ProjectIDSchema).annotate({
      description:
        "Optional parent project identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
    }),
  }).annotate({ description: "Project relationships, including an optional parent project." }),
});

export const ProjectGoalSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  relations: Schema.Struct({
    project: idSchema(
      "Required owning project identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
    ),
    partOf: Schema.NullOr(ProjectGoalIDSchema).annotate({
      description:
        "Optional parent project goal identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
    }),
  }).annotate({
    description: "Project goal relationships, including its project and optional parent goal.",
  }),
});

export type Project = typeof ProjectSchema.Type;
export type ProjectGoal = typeof ProjectGoalSchema.Type;
