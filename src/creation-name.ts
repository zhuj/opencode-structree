import { Schema } from "effect";
import { isValidInputId } from "./lib/base-schema.ts";

export const CreationNameSchema = Schema.String.annotate({
  description:
    "Descriptive slug for the stable id and filename, for example source-evidence. Letters, digits and single hyphens only; lowercased on creation.",
}).check(
  Schema.makeFilter((name) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(name) && isValidInputId(name), {
    message: "Supply a portable descriptive slug using letters, digits and single hyphens.",
  }),
);
