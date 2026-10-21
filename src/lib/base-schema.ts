import { Schema } from "effect";

/** The stored filename domain shared by normalized creation and filesystem discovery. */
export function isValidId(id: string): boolean {
  for (const character of id) {
    const unit = character.charCodeAt(0);
    if (
      unit < 0x20 ||
      unit === 0x7f ||
      (character.length === 1 && unit >= 0xd800 && unit <= 0xdfff)
    )
      return false;
  }
  return (
    id.trim().length > 0 &&
    id === id.toLowerCase() &&
    !id.includes("/") &&
    !id.includes("\\") &&
    id !== "." &&
    id !== ".." &&
    !id.startsWith(".") &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(id) &&
    Buffer.byteLength(id, "utf8") <= 200
  );
}

export function isValidInputId(id: string): boolean {
  return isValidId(id.toLowerCase());
}

const idFilter = Schema.makeFilter(isValidInputId, {
  message:
    "After lowercasing, the id must be a nonblank portable file name: no path separator, leading dot, control character or unpaired surrogate, not a reserved device name, and at most 200 UTF-8 bytes.",
});

/**
 * An identifier schema carries the domain filter and the description in one place. The
 * description is attached before the filter, because a schema that is annotated after it
 * publishes neither the description nor the length bound in its JSON Schema.
 */
export const idSchema = (description: string): typeof Schema.NonEmptyString =>
  Schema.NonEmptyString.annotate({ description }).check(idFilter);

export const IDSchema = idSchema(
  "The id is lowercased and must be a nonblank portable file name: no path separator, leading dot, control character or unpaired surrogate, not a reserved device name, and at most 200 UTF-8 bytes.",
);
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
    description:
      "Retirement timestamp, or null for an active object. A retired object is still listed and searchable; check this field to exclude it.",
  }),
  tags: Schema.Record(Schema.String, Schema.String).annotate({
    description: "String-valued object tags.",
  }),
  metadata: Schema.Record(Schema.String, Schema.Any).annotate({
    description: "Additional object metadata. Persisted values must be JSON-compatible.",
  }),
});
