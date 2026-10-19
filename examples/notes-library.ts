import {
  BaseObjectSchema,
  createFramework,
  type FrameworkConfigInput,
  type ObjectDefinition,
} from "@local/object-mcp/lib";
import { Schema } from "effect";

export const NoteSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  topic: Schema.String.annotate({ description: "Subject used to organize the note." }),
  pinned: Schema.Boolean.annotate({
    description: "Whether the note stays at the top of its topic.",
  }),
});

export type Note = typeof NoteSchema.Type;

export const noteDefinition = {
  name: "note",
  directory: "notes",
  description: "Knowledge notes grouped by topic, with an optional pinned presentation.",
  schema: NoteSchema,
} satisfies ObjectDefinition<Note>;

export function createNotesFramework(workspace: string, config: FrameworkConfigInput = {}) {
  return createFramework({
    baseDirectory: workspace,
    definitions: [noteDefinition],
    config: {
      ...config,
      root: config.root ?? "notes-vault",
      sqlite: { path: ".notes/index.sqlite", ...config.sqlite },
      embeddings: config.embeddings ?? { provider: "disabled" },
    },
  });
}
