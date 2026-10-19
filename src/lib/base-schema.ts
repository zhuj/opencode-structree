import { Schema } from "effect";

export const IDSchema = Schema.String.annotate({ description: "Object identifier." });
export const XIDSchema = IDSchema;
export const NameSchema = Schema.String.annotate({ description: "Object name." });

export const BaseObjectSchema = Schema.Struct({
  id: IDSchema,
  name: NameSchema,
  title: Schema.String.annotate({ description: "Human-readable object title." }),
  description: Schema.String.annotate({
    description: "Object description, separate from its Markdown body.",
  }),
  createdAt: Schema.Date.annotate({ description: "Object creation timestamp." }),
  updatedAt: Schema.Date.annotate({ description: "Most recent object update timestamp." }),
  retiredAt: Schema.NullOr(Schema.Date).annotate({
    description: "Retirement timestamp, or null for an active object.",
  }),
  tags: Schema.Record(Schema.String, Schema.String).annotate({
    description: "String-valued object tags.",
  }),
  metadata: Schema.Record(Schema.String, Schema.Any).annotate({
    description: "Additional object metadata. Persisted values must be JSON-compatible.",
  }),
});
